import { sql } from 'drizzle-orm';
import { query } from '../db/query';

const RETENTION_BATCH_SIZE = 1_000;
const MAX_BATCHES_PER_RUN = 100;
export const OPERATIONAL_RETENTION_INTERVAL_MS = 60_000;

export type RetentionCleanupResult = {
  idempotencyRecords: number;
  tokenAuditEvents: number;
  oauthClientAssertions: number;
  oauthAccessTokenRevocations: number;
  invitationEmailAttempts: number;
  invitationSendAttempts: number;
  pendingInvitations: number;
};

async function deleteExpiredIdempotencyBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select id from api_idempotency_records
      where expires_at <= now()
      order by expires_at, id
      limit ${RETENTION_BATCH_SIZE}
      for update skip locked
    )
    delete from api_idempotency_records records
    using candidates
    where records.id = candidates.id`);
  return result.rowCount ?? 0;
}

async function deleteExpiredTokenAuditBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select id from api_token_audit_events
      where created_at < now() - interval '90 days'
      order by created_at, id
      limit ${RETENTION_BATCH_SIZE}
      for update skip locked
    )
    delete from api_token_audit_events events
    using candidates
    where events.id = candidates.id`);
  return result.rowCount ?? 0;
}

async function deleteExpiredOAuthClientAssertionsBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select id from oauth_client_assertions
      where expires_at <= now()
      order by expires_at, id
      limit ${RETENTION_BATCH_SIZE}
      for update skip locked
    )
    delete from oauth_client_assertions assertions
    using candidates
    where assertions.id = candidates.id`);
  return result.rowCount ?? 0;
}

async function deleteExpiredOAuthAccessTokenRevocationsBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select token_hash from oauth_access_token_revocations
      where expires_at <= now()
      order by expires_at, token_hash
      limit ${RETENTION_BATCH_SIZE}
      for update skip locked
    )
    delete from oauth_access_token_revocations revocations
    using candidates
    where revocations.token_hash = candidates.token_hash`);
  return result.rowCount ?? 0;
}

async function deleteRetainedInvitationSendAttemptsBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select attempt.id
      from invitation_send_attempts attempt
      where attempt.status in ('sent', 'failed', 'superseded')
        and attempt.completed_at < now() - interval '24 hours'
        and exists (
          select 1 from invitation_send_attempts newer
          where newer.invitation_id = attempt.invitation_id
            and (newer.attempted_at, newer.id) > (attempt.attempted_at, attempt.id)
        )
      order by attempt.completed_at, attempt.id
      limit ${RETENTION_BATCH_SIZE}
      for update of attempt skip locked
    )
    delete from invitation_send_attempts attempts
    using candidates
    where attempts.id = candidates.id`);
  return result.rowCount ?? 0;
}

async function deleteExpiredInvitationEmailAttemptsBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select id from invitation_email_attempts
      where attempted_at < now() - interval '25 hours'
      order by attempted_at, id
      limit ${RETENTION_BATCH_SIZE}
      for update skip locked
    )
    delete from invitation_email_attempts attempts
    using candidates
    where attempts.id = candidates.id`);
  return result.rowCount ?? 0;
}

async function deleteRetainedPendingInvitationsBatch(): Promise<number> {
  const result = await query(sql`with candidates as (
      select invitation.id
      from pending_invitations invitation
      where (invitation.status = 'pending'
             and invitation.expires_at < now() - interval '7 days')
        or (invitation.status <> 'pending'
            and invitation.resolved_at < now() - interval '7 days')
        or (
          invitation.target_type = 'workspace'
          and not exists (select 1 from users where users.id = invitation.target_id)
        )
        or (
          invitation.target_type = 'page'
          and not exists (
            select 1 from pages
            where pages.id = invitation.target_id and pages.is_deleted = false
          )
        )
        or (
          invitation.target_type = 'folder'
          and not exists (
            select 1 from folders
            where folders.id = invitation.target_id and folders.is_deleted = false
          )
        )
      order by invitation.updated_at, invitation.id
      limit ${RETENTION_BATCH_SIZE}
      for update of invitation skip locked
    )
    delete from pending_invitations invitations
    using candidates
    where invitations.id = candidates.id`);
  return result.rowCount ?? 0;
}

async function drainCleanupBatches(cleanup: () => Promise<number>): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const batchSize = await cleanup();
    deleted += batchSize;
    if (batchSize < RETENTION_BATCH_SIZE) break;
  }
  return deleted;
}

async function drainInvitationRetention(): Promise<{
  invitationEmailAttempts: number;
  invitationSendAttempts: number;
  pendingInvitations: number;
}> {
  // Drain child delivery history before parent invitations so cleanup does
  // not compete with the invitation foreign-key cascade.
  const invitationSendAttempts = await drainCleanupBatches(
    deleteRetainedInvitationSendAttemptsBatch,
  );
  const invitationEmailAttempts = await drainCleanupBatches(
    deleteExpiredInvitationEmailAttemptsBatch,
  );
  const pendingInvitations = await drainCleanupBatches(deleteRetainedPendingInvitationsBatch);
  return { invitationEmailAttempts, invitationSendAttempts, pendingInvitations };
}

export async function drainOperationalRetention(): Promise<RetentionCleanupResult> {
  const [
    idempotencyRecords,
    tokenAuditEvents,
    oauthClientAssertions,
    oauthAccessTokenRevocations,
    invitationRetention,
  ] = await Promise.all([
    drainCleanupBatches(deleteExpiredIdempotencyBatch),
    drainCleanupBatches(deleteExpiredTokenAuditBatch),
    drainCleanupBatches(deleteExpiredOAuthClientAssertionsBatch),
    drainCleanupBatches(deleteExpiredOAuthAccessTokenRevocationsBatch),
    drainInvitationRetention(),
  ]);
  return {
    idempotencyRecords,
    tokenAuditEvents,
    oauthClientAssertions,
    oauthAccessTokenRevocations,
    ...invitationRetention,
  };
}
