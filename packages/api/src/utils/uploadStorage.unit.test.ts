import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import {
  createUploadStorage,
  isUploadNotFoundError,
  LocalUploadStorage,
  R2UploadStorage,
  readStoredUploads,
  type UploadStorage,
} from './uploadStorage';

function r2Storage(send: ReturnType<typeof vi.fn>) {
  const client = { send } as unknown as S3Client;
  return new R2UploadStorage('uploads', 'account', 'access', 'secret', client);
}

describe('upload storage configuration', () => {
  it('allows explicit local storage in production', () => {
    expect(createUploadStorage({ NODE_ENV: 'production', UPLOAD_STORAGE: 'local' })).toBeInstanceOf(
      LocalUploadStorage,
    );
  });

  it('requires an explicit production backend and complete R2 credentials', () => {
    expect(() => createUploadStorage({ NODE_ENV: 'production' })).toThrow(
      'UPLOAD_STORAGE must be set to local or r2 in production',
    );
    expect(() =>
      createUploadStorage({
        NODE_ENV: 'production',
        UPLOAD_STORAGE: 'r2',
        R2_ACCOUNT_ID: 'account',
      }),
    ).toThrow('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are required');
  });

  it('rejects invalid object keys before accessing storage', async () => {
    const storage = new LocalUploadStorage();
    await expect(storage.get('../secret')).rejects.toThrow('Invalid upload object key');
    await expect(storage.get('.hidden')).rejects.toThrow('Invalid upload object key');
  });
});

describe('bulk upload reads', () => {
  it('skips missing objects but surfaces storage outages', async () => {
    const missing = new Error('missing');
    missing.name = 'NoSuchKey';
    const get = vi
      .fn<(key: string) => Promise<Buffer>>()
      .mockResolvedValueOnce(Buffer.from('image'))
      .mockRejectedValueOnce(missing);
    const storage: UploadStorage = {
      delete: vi.fn(),
      get,
      put: vi.fn(),
    };

    await expect(readStoredUploads(['one.png', 'missing.png'], storage, 1)).resolves.toEqual(
      new Map([['one.png', Buffer.from('image')]]),
    );

    const unavailable = new Error('R2 unavailable');
    get.mockRejectedValueOnce(unavailable);
    await expect(readStoredUploads(['unavailable.png'], storage, 1)).rejects.toBe(unavailable);
  });

  it('does not mistake a missing bucket for a missing object', async () => {
    const missingBucket = Object.assign(new Error('bucket does not exist'), {
      name: 'NoSuchBucket',
      $metadata: { httpStatusCode: 404 },
    });
    const storage: UploadStorage = {
      delete: vi.fn(),
      get: vi.fn().mockRejectedValue(missingBucket),
      put: vi.fn(),
    };

    expect(isUploadNotFoundError(missingBucket)).toBe(false);
    await expect(readStoredUploads(['image.png'], storage)).rejects.toBe(missingBucket);
  });
});

describe('R2 upload storage', () => {
  it('sends put, get, and delete commands', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
      })
      .mockResolvedValueOnce({});
    const storage = r2Storage(send);

    await storage.put('image.png', new Uint8Array([1, 2, 3]), 'image/png');
    await expect(storage.get('image.png')).resolves.toEqual(Buffer.from([1, 2, 3]));
    await storage.delete('image.png');

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('does not hide R2 failures behind local storage', async () => {
    const unavailable = new Error('R2 unavailable');
    const send = vi.fn().mockRejectedValue(unavailable);
    const storage = r2Storage(send);

    await expect(storage.get('image.png')).rejects.toBe(unavailable);
  });
});
