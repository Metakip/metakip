import { GUEST_IDENTITY_LOCK_PREFIX } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';

export const GUEST_IDENTITY_RETENTION_DAYS = 90;
export const GUEST_IDENTITY_CLEANUP_BATCH_SIZE = 1_000;
const GUEST_IDENTITY_TOMBSTONE_RETENTION_DAYS = 365;

type GuestIdentityCleanupBatchResult = {
  deleted: number;
  pruned: number;
};

async function cleanupGuestIdentityBatch(
  executor: QueryExecutor,
  retentionDays: number,
  batchSize: number,
): Promise<GuestIdentityCleanupBatchResult> {
  const result = await executeQuery<GuestIdentityCleanupBatchResult>(
    executor,
    sql`with candidates as materialized (
      select guest.id
      from guest_identities guest
      where guest.last_seen_at < now() - (${retentionDays} * interval '1 day')
        and not exists (select 1 from comments where comments.guest_id = guest.id)
        and not exists (select 1 from comment_replies where comment_replies.guest_id = guest.id)
        and not exists (select 1 from uploads where uploads.uploaded_by_guest_id = guest.id)
      order by guest.last_seen_at asc
      limit ${batchSize}
    ), locked as materialized (
      select id, pg_advisory_xact_lock(hashtextextended(${GUEST_IDENTITY_LOCK_PREFIX} || id::text, 0))
      from candidates
    ), deleted as (
      delete from guest_identities guest
      using locked
      where guest.id = locked.id
        and guest.last_seen_at < now() - (${retentionDays} * interval '1 day')
        and not exists (select 1 from comments where comments.guest_id = guest.id)
        and not exists (select 1 from comment_replies where comment_replies.guest_id = guest.id)
        and not exists (select 1 from uploads where uploads.uploaded_by_guest_id = guest.id)
      returning guest.id
    ), tombstoned as (
      insert into guest_identity_tombstones (id, expired_at)
      select id, now() from deleted
      on conflict (id) do update set expired_at = excluded.expired_at
    ), tombstones_to_prune as materialized (
      select id
      from guest_identity_tombstones
      where expired_at < now() - (${GUEST_IDENTITY_TOMBSTONE_RETENTION_DAYS} * interval '1 day')
      order by expired_at asc
      limit ${batchSize}
    ), pruned as (
      delete from guest_identity_tombstones
      where id in (select id from tombstones_to_prune)
      returning id
    )
    select
      (select count(*)::int from deleted) as deleted,
      (select count(*)::int from pruned) as pruned`,
  );
  return result.rows[0] ?? { deleted: 0, pruned: 0 };
}

/**
 * Remove expired guest identities that do not author durable records.
 * Referenced identities remain so comments, replies, and upload audit data
 * retain a valid author.
 */
export async function cleanupExpiredGuestIdentities(
  executor: QueryExecutor = db,
  retentionDays = GUEST_IDENTITY_RETENTION_DAYS,
  batchSize = GUEST_IDENTITY_CLEANUP_BATCH_SIZE,
): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Guest identity cleanup batch size must be a positive integer');
  }
  return (await cleanupGuestIdentityBatch(executor, retentionDays, batchSize)).deleted;
}

export async function drainExpiredGuestIdentities(
  executor: QueryExecutor = db,
  retentionDays = GUEST_IDENTITY_RETENTION_DAYS,
  batchSize = GUEST_IDENTITY_CLEANUP_BATCH_SIZE,
): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Guest identity cleanup batch size must be a positive integer');
  }
  let totalDeleted = 0;
  while (true) {
    const batch = await cleanupGuestIdentityBatch(executor, retentionDays, batchSize);
    totalDeleted += batch.deleted;
    if (batch.deleted < batchSize && batch.pruned < batchSize) return totalDeleted;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
