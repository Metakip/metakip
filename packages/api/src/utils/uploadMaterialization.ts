import { sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import {
  cancelUploadDeletion,
  scheduleUploadDeletion,
  UPLOAD_MATERIALIZATION_CLEANUP_DELAY_MS,
} from './uploadCleanup';
import { getUploadStorage, type UploadStorage } from './uploadStorage';

const UPLOAD_FINALIZATION_LOCK_TIMEOUT = '30s';
const UPLOAD_FINALIZATION_STATEMENT_TIMEOUT = '60s';
const UPLOAD_FINALIZATION_TRANSACTION_TIMEOUT = '90s';

export interface UploadMaterializationCoordinator {
  cancel(filename: string, executor: QueryExecutor): Promise<void>;
  finalize<T>(filename: string, operation: (executor: QueryExecutor) => Promise<T>): Promise<T>;
  schedule(filename: string, deleteAfter: Date): Promise<void>;
}

const durableCoordinator: UploadMaterializationCoordinator = {
  cancel: cancelUploadDeletion,
  finalize: (filename, operation) =>
    db.transaction(async (tx) => {
      await executeQuery(
        tx,
        sql`select
              set_config('lock_timeout', ${UPLOAD_FINALIZATION_LOCK_TIMEOUT}, true),
              set_config('statement_timeout', ${UPLOAD_FINALIZATION_STATEMENT_TIMEOUT}, true),
              set_config(
                'transaction_timeout',
                ${UPLOAD_FINALIZATION_TRANSACTION_TIMEOUT},
                true
              )`,
      );
      const cleanupIntent = await executeQuery<{ id: string }>(
        tx,
        sql`select id
            from upload_deletion_queue
            where filename = ${filename} and claim_token is null
            for update`,
      );
      if (!cleanupIntent.rows[0]) {
        throw new Error('Upload materialization cleanup intent is missing');
      }
      return operation(tx);
    }),
  schedule: scheduleUploadDeletion,
};

export type UploadMaterializationFinalizer<T> = (
  executor: QueryExecutor,
  result: T,
) => Promise<void>;

export type UploadMaterializationOptions<T> = {
  afterPersist?: UploadMaterializationFinalizer<T>;
  contentType?: string;
  storage?: UploadStorage;
  coordinator?: UploadMaterializationCoordinator;
};

export type PreparedUpload<T> = {
  content: Uint8Array;
  contentType: string;
  filename: string;
  persist(executor: QueryExecutor): Promise<T>;
};

/**
 * Register durable compensation before writing bytes, then persist metadata.
 * Failed or uncertain writes remain queued for cleanup; completed metadata is
 * authoritative and protects its object from a stale cleanup intent.
 */
export async function materializeUploadFile<T>(
  filename: string,
  content: Uint8Array,
  persist: (executor: QueryExecutor) => Promise<T>,
  options: UploadMaterializationOptions<T> = {},
): Promise<T> {
  const {
    afterPersist,
    contentType = 'application/octet-stream',
    storage = getUploadStorage(),
    coordinator = durableCoordinator,
  } = options;
  await coordinator.schedule(
    filename,
    new Date(Date.now() + UPLOAD_MATERIALIZATION_CLEANUP_DELAY_MS),
  );

  // Object storage can be remote and slow. Keep it outside the database
  // transaction; the delayed cleanup intent compensates for a crash or failed
  // write without occupying a database connection while bytes are transferred.
  await storage.put(filename, content, contentType);

  return coordinator.finalize(filename, async (executor) => {
    // Lock the cleanup intent only while metadata and cancellation are
    // committed together. If cleanup already claimed an expired intent, this
    // waits for that decision instead of publishing metadata for missing bytes.
    const result = await persist(executor);
    await afterPersist?.(executor, result);
    await coordinator.cancel(filename, executor);
    return result;
  });
}

export async function materializePreparedUpload<T>(
  upload: PreparedUpload<T>,
  options: Omit<UploadMaterializationOptions<T>, 'contentType'> = {},
): Promise<T> {
  return materializeUploadFile(upload.filename, upload.content, upload.persist, {
    ...options,
    contentType: upload.contentType,
  });
}
