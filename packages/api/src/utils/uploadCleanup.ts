import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { getApiLogger } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { uploadsDir } from '../env';

export type UploadFileRemover = (filePath: string) => Promise<void>;

export type UploadCleanupResult = {
  failed: number;
  processed: number;
};

/**
 * Lock every upload referenced by the target pages before checking whether it
 * has a surviving reference. The lock is intentionally a separate statement:
 * under READ COMMITTED, a waiter receives a fresh snapshot for the orphan
 * recheck after an overlapping purge commits.
 *
 * Upload deletion and durable file-cleanup enqueueing happen in one statement
 * and therefore in the same transaction as the caller's page deletion.
 */
export async function purgeUnreferencedUploadsForPages(
  executor: QueryExecutor,
  pageIds: readonly string[],
): Promise<string[]> {
  if (pageIds.length === 0) return [];

  const candidates = await executeQuery<{ id: string }>(
    executor,
    sql`select u.id
     from uploads u
     where exists (
       select 1
       from upload_page_refs target_ref
       where target_ref.upload_id = u.id
         and target_ref.page_id = any(${sql.param([...pageIds])}::uuid[])
     )
     order by u.id
     for update of u`,
  );
  const uploadIds = candidates.rows.map((row) => row.id);
  if (uploadIds.length === 0) return [];

  const result = await executeQuery<{ filename: string }>(
    executor,
    sql`with deleted as (
       delete from uploads u
       where u.id = any(${sql.param(uploadIds)}::uuid[])
         and not exists (
           select 1
           from upload_page_refs surviving_ref
           where surviving_ref.upload_id = u.id
             and not (surviving_ref.page_id = any(${sql.param([...pageIds])}::uuid[]))
         )
       returning u.filename
     ), queued as (
       insert into upload_deletion_queue (filename)
       select filename
       from deleted
       on conflict (filename) do update
       set updated_at = now(), last_error = null
       returning filename
     )
     select filename
     from queued
     order by filename`,
  );
  return result.rows.map((row) => row.filename);
}

/**
 * Drain durable cleanup jobs after the database transaction commits. A crash
 * after unlink but before queue deletion is safe because ENOENT is success on
 * the next attempt. Other failures stay queued for startup/next-purge retry.
 */
export async function processUploadDeletionQueue(
  executor: QueryExecutor = db,
  removeFile: UploadFileRemover = unlink,
  batchSize = 100,
): Promise<UploadCleanupResult> {
  const jobs = await executeQuery<{ filename: string; id: string }>(
    executor,
    sql`select id, filename
     from upload_deletion_queue
     order by updated_at, id
     limit ${batchSize}`,
  );
  let failed = 0;
  let processed = 0;

  for (const job of jobs.rows) {
    try {
      if (path.basename(job.filename) !== job.filename) {
        throw new Error('Upload cleanup filename is not a basename');
      }
      await removeFile(path.join(uploadsDir, job.filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        await executeQuery(
          executor,
          sql`update upload_deletion_queue
           set attempts = attempts + 1,
               last_error = ${message},
               updated_at = now()
           where id = ${job.id}`,
        );
        getApiLogger().error('Upload file cleanup failed and remains queued', {
          error: message,
          filename: job.filename,
        });
        continue;
      }
    }

    await executeQuery(executor, sql`delete from upload_deletion_queue where id = ${job.id}`);
    processed += 1;
  }

  return { failed, processed };
}

/**
 * A deletion transaction has already committed when this drain runs. Queue
 * rows are durable, so an unexpected database or filesystem-drain failure is
 * logged and left for startup or a later drain instead of turning a completed
 * destructive operation into a retry-unsafe API failure.
 */
export async function drainUploadDeletionQueueBestEffort(
  processQueue: () => Promise<UploadCleanupResult> = processUploadDeletionQueue,
): Promise<boolean> {
  try {
    await processQueue();
    return true;
  } catch (error) {
    getApiLogger().error('Post-commit upload deletion queue drain failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
