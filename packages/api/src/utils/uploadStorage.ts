import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { uploadsDir } from '../env';

export interface UploadStorage {
  delete(key: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  put(key: string, content: Uint8Array, contentType: string): Promise<void>;
}

const DEFAULT_UPLOAD_READ_CONCURRENCY = 8;
const R2_OPERATION_TIMEOUT_MS = 2 * 60 * 1000;

function r2OperationOptions(): { abortSignal: AbortSignal } {
  return { abortSignal: AbortSignal.timeout(R2_OPERATION_TIMEOUT_MS) };
}

export function isUploadNotFoundError(error: unknown): boolean {
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return true;
  return (error as { name?: string } | undefined)?.name === 'NoSuchKey';
}

function assertObjectKey(key: string): void {
  if (
    !key ||
    key.startsWith('.') ||
    basename(key) !== key ||
    !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(key)
  ) {
    throw new Error('Invalid upload object key');
  }
}

export class LocalUploadStorage implements UploadStorage {
  constructor(private readonly directory = uploadsDir) {}

  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    await unlink(join(this.directory, key));
  }

  async get(key: string): Promise<Buffer> {
    assertObjectKey(key);
    return readFile(join(this.directory, key));
  }

  async put(key: string, content: Uint8Array): Promise<void> {
    assertObjectKey(key);
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, key), content);
  }
}

export class R2UploadStorage implements UploadStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
  }

  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      r2OperationOptions(),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertObjectKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      r2OperationOptions(),
    );
    if (!response.Body) throw new Error('Upload object body is missing');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async put(key: string, content: Uint8Array, contentType: string): Promise<void> {
    assertObjectKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
      }),
      r2OperationOptions(),
    );
  }
}

export function createR2UploadStorage(env: NodeJS.ProcessEnv = process.env): R2UploadStorage {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are required',
    );
  }
  return new R2UploadStorage(bucket, accountId, accessKeyId, secretAccessKey);
}

let storage: UploadStorage | undefined;

export function createUploadStorage(env: NodeJS.ProcessEnv = process.env): UploadStorage {
  const backend = env.UPLOAD_STORAGE ?? (env.NODE_ENV === 'production' ? undefined : 'local');
  if (backend === undefined) {
    throw new Error('UPLOAD_STORAGE must be set to local or r2 in production');
  }
  if (backend === 'local') return new LocalUploadStorage();
  if (backend !== 'r2') {
    throw new Error('UPLOAD_STORAGE must be set to local or r2');
  }
  return createR2UploadStorage(env);
}

export function getUploadStorage(): UploadStorage {
  storage ??= createUploadStorage();
  return storage;
}

export async function readStoredUploads(
  keys: Iterable<string>,
  uploadStorage: UploadStorage = getUploadStorage(),
  concurrency = DEFAULT_UPLOAD_READ_CONCURRENCY,
): Promise<Map<string, Buffer>> {
  const uniqueKeys = [...new Set(keys)];
  const uploads = new Map<string, Buffer>();
  let nextIndex = 0;
  let failure: unknown;
  let hasFailure = false;

  const worker = async (): Promise<void> => {
    while (!hasFailure && nextIndex < uniqueKeys.length) {
      const key = uniqueKeys[nextIndex];
      nextIndex += 1;
      if (!key) continue;
      try {
        uploads.set(key, await uploadStorage.get(key));
      } catch (error) {
        if (!isUploadNotFoundError(error)) {
          failure = error;
          hasFailure = true;
        }
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), uniqueKeys.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (hasFailure) throw failure;
  return uploads;
}

export function setUploadStorageForTests(value: UploadStorage | undefined): void {
  storage = value;
}
