import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { getApiLogger } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { getUploadStorage } from './uploadStorage';

export type UploadRemover = (key: string) => Promise<void>;

const removeStoredUpload: UploadRemover = (key) => getUploadStorage().delete(key);

export const UPLOAD_MATERIALIZATION_CLEANUP_DELAY_MS = 15 * 60 * 1000;
const UPLOAD_CLEANUP_CLAIM_LEASE_MS = 5 * 60 * 1000;
const UPLOAD_CLEANUP_RETRY_DELAY_MS = 60 * 1000;
const UPLOAD_CLEANUP_CONCURRENCY = 4;

export async function scheduleUploadDeletion(
  filename: string,
  deleteAfter: Date = new Date(),
  executor: QueryExecutor = db,
): Promise<void> {
  if (basename(filename) !== filename) {
    throw new Error('Upload cleanup filename is not a basename');
  }
  const scheduled = await executeQuery<{ id: string }>(
    executor,
    sql`insert into upload_deletion_queue (filename, delete_after)
        values (${filename}, ${deleteAfter})
        on conflict (filename) do update
        set delete_after = excluded.delete_after,
            claim_token = null,
            updated_at = now(),
            last_error = null
        where upload_deletion_queue.claim_token is null
           or upload_deletion_queue.delete_after <= now()
        returning id`,
  );
  if (!scheduled.rows[0]) {
    throw new Error('Upload cleanup is already in progress for this filename');
  }
}

export async function cancelUploadDeletion(
  filename: string,
  executor: QueryExecutor = db,
): Promise<void> {
  await executeQuery(
    executor,
    sql`delete from upload_deletion_queue
        where filename = ${filename} and claim_token is null`,
  );
}

export type UploadCleanupResult = {
  failed: number;
  processed: number;
};

type UploadCleanupJob = { claimToken: string; filename: string; id: string };
type UploadCleanupBatch = { jobs: UploadCleanupJob[]; tracked: number };
type UploadCleanupJobResult = 'failed' | 'processed' | null;

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
       set delete_after = now(), updated_at = now(), last_error = null
       returning filename
     )
     select filename
     from queued
     order by filename`,
  );
  return result.rows.map((row) => row.filename);
}

/**
 * Claim durable cleanup jobs in short transactions, then remove objects without
 * holding database connections or row locks across storage I/O. Expired claims
 * are safe to retry because object deletion is idempotent.
 */
export async function processUploadDeletionQueue(
  executor: typeof db = db,
  removeUpload: UploadRemover = removeStoredUpload,
  batchSize = 100,
): Promise<UploadCleanupResult> {
  const claimJobs = (limit: number): Promise<UploadCleanupBatch> =>
    executor.transaction(async (tx): Promise<UploadCleanupBatch> => {
      const ready = await executeQuery<{ filename: string; id: string }>(
        tx,
        sql`select id, filename
            from upload_deletion_queue
            where delete_after <= now()
            order by updated_at, id
            for update skip locked
            limit ${limit}`,
      );
      if (ready.rows.length === 0) return { jobs: [], tracked: 0 };

      const trackedUploads = await executeQuery<{ filename: string }>(
        tx,
        sql`select filename
            from uploads
            where filename = any(${sql.param(ready.rows.map((job) => job.filename))}::text[])`,
      );
      const trackedFilenames = new Set(trackedUploads.rows.map((upload) => upload.filename));
      const trackedJobs = ready.rows.filter((job) => trackedFilenames.has(job.filename));
      const untrackedJobs = ready.rows.filter((job) => !trackedFilenames.has(job.filename));

      if (trackedJobs.length > 0) {
        await executeQuery(
          tx,
          sql`delete from upload_deletion_queue
              where id = any(${sql.param(trackedJobs.map((job) => job.id))}::uuid[])`,
        );
      }

      const claimToken = randomUUID();
      if (untrackedJobs.length > 0) {
        await executeQuery(
          tx,
          sql`update upload_deletion_queue
              set claim_token = ${claimToken},
                  delete_after = ${new Date(Date.now() + UPLOAD_CLEANUP_CLAIM_LEASE_MS)},
                  updated_at = now()
              where id = any(${sql.param(untrackedJobs.map((job) => job.id))}::uuid[])`,
        );
      }
      return {
        jobs: untrackedJobs.map((job) => ({ ...job, claimToken })),
        tracked: trackedJobs.length,
      };
    });

  const processJob = async (job: UploadCleanupJob): Promise<UploadCleanupJobResult> => {
    try {
      if (basename(job.filename) !== job.filename) {
        throw new Error('Upload cleanup filename is not a basename');
      }
      await removeUpload(job.filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const message = error instanceof Error ? error.message : String(error);
        const released = await executeQuery(
          executor,
          sql`update upload_deletion_queue
              set attempts = attempts + 1,
                  last_error = ${message},
                  claim_token = null,
                  delete_after = ${new Date(Date.now() + UPLOAD_CLEANUP_RETRY_DELAY_MS)},
                  updated_at = now()
              where id = ${job.id} and claim_token = ${job.claimToken}`,
        );
        getApiLogger().error('Upload file cleanup failed and remains queued', {
          error: message,
          filename: job.filename,
        });
        return released.rowCount === 1 ? 'failed' : null;
      }
    }

    const completed = await executeQuery(
      executor,
      sql`delete from upload_deletion_queue
          where id = ${job.id} and claim_token = ${job.claimToken}`,
    );
    return completed.rowCount === 1 ? 'processed' : null;
  };

  const maxJobs = Math.max(0, Math.floor(batchSize));
  let failed = 0;
  let processed = 0;
  let remaining = maxJobs;
  while (remaining > 0) {
    const batch = await claimJobs(Math.min(UPLOAD_CLEANUP_CONCURRENCY, remaining));
    const claimed = batch.jobs.length + batch.tracked;
    if (claimed === 0) break;
    remaining -= claimed;
    processed += batch.tracked;

    const outcomes = await Promise.allSettled(batch.jobs.map(processJob));
    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    if (rejected) throw rejected.reason;
    for (const outcome of outcomes) {
      if (outcome.status !== 'fulfilled') continue;
      if (outcome.value === 'failed') failed += 1;
      if (outcome.value === 'processed') processed += 1;
    }
  }

  return { failed, processed };
}
