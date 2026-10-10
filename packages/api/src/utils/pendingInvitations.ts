import { createHash, randomBytes } from 'node:crypto';
import type {
  InvitationClaimStatus,
  InvitationDeliveryStatus,
  InvitationTargetType,
  PendingInvitation,
  ShareEntityType,
  SharePermission,
  WorkspaceRole,
} from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import type { InvitationDatabaseRecord } from '../db/invitationSchema';
import { executeQuery, type QueryExecutor } from '../db/query';
import {
  ensureCanAdminEntity,
  lockEntityAccessExclusive,
  lockWorkspaceAccessExclusive,
} from './share-access';

export type InvitationRecord = InvitationDatabaseRecord;

async function lockInvitationTarget(
  executor: QueryExecutor,
  invitation: InvitationRecord,
): Promise<string> {
  if (invitation.target_type === 'workspace') {
    await lockWorkspaceAccessExclusive(executor, invitation.target_id);
    return invitation.target_id;
  }
  return lockEntityAccessExclusive(executor, invitation.target_type, invitation.target_id);
}

type LockedInvitation = { invitation: InvitationRecord; workspaceOwnerId: string };

async function lockCurrentInvitation(
  executor: QueryExecutor,
  initial: InvitationRecord,
  requireMatchingToken: boolean,
): Promise<LockedInvitation | null> {
  const workspaceOwnerId = await lockInvitationTarget(executor, initial);
  const result = await executeQuery<InvitationRecord>(
    executor,
    sql`select * from pending_invitations where id = ${initial.id} for update`,
  );
  const invitation = result.rows[0];
  return invitation && (!requireMatchingToken || invitation.token_hash === initial.token_hash)
    ? { invitation, workspaceOwnerId }
    : null;
}

export async function lockInvitationRecordIfPresent(
  executor: QueryExecutor,
  initial: InvitationRecord,
): Promise<InvitationRecord | null> {
  const locked = await lockCurrentInvitation(executor, initial, false);
  return locked?.invitation ?? null;
}

export async function lockInvitationRecord(
  executor: QueryExecutor,
  initial: InvitationRecord,
): Promise<InvitationRecord> {
  const invitation = await lockInvitationRecordIfPresent(executor, initial);
  if (!invitation) throw new HTTPException(404, { message: 'Invitation not found' });
  return invitation;
}

async function lockInvitationTokenRecord(
  executor: QueryExecutor,
  initial: InvitationRecord,
): Promise<LockedInvitation> {
  const locked = await lockCurrentInvitation(executor, initial, true);
  if (!locked) throw new HTTPException(404, { message: 'Invitation not found' });
  return locked;
}

type LockedInvitationOperation<T> = (
  executor: QueryExecutor,
  invitation: InvitationRecord,
) => Promise<T>;

export async function withLockedInvitationById<T>(
  invitationId: string,
  operation: LockedInvitationOperation<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const initial = await findInvitationById(invitationId, tx);
    if (!initial) throw new HTTPException(404, { message: 'Invitation not found' });
    return operation(tx, await lockInvitationRecord(tx, initial));
  });
}

export async function withLockedInvitationByToken<T>(
  token: string,
  operation: (
    executor: QueryExecutor,
    invitation: InvitationRecord,
    workspaceOwnerId: string,
  ) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const initial = await findInvitationByToken(token, tx);
    if (!initial) throw new HTTPException(404, { message: 'Invitation not found' });
    const { invitation, workspaceOwnerId } = await lockInvitationTokenRecord(tx, initial);
    return operation(tx, invitation, workspaceOwnerId);
  });
}

export type PreparedInvitation = {
  invitation: InvitationRecord;
  token: string;
};

export type InvitationPreparation =
  | PreparedInvitation
  | { invitation: InvitationRecord; token: null };

export type InvitationPreparationParams =
  | {
      targetType: 'workspace';
      targetId: string;
      email: string;
      permission: WorkspaceRole;
      invitedBy: string;
    }
  | {
      targetType: ShareEntityType;
      targetId: string;
      email: string;
      permission: SharePermission;
      invitedBy: string;
    };

export type InvitationResolution =
  | { status: 'accepted'; userId: string }
  | { status: 'declined' }
  | { status: 'revoked' }
  | { status: 'superseded' };

export const hashInvitationToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function normalizeInvitationEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HTTPException(400, { message: 'A valid email is required' });
  }
  return normalized;
}

export async function invitationClaimStatus(
  invitation: InvitationRecord,
  executor: QueryExecutor = db,
): Promise<InvitationClaimStatus> {
  const current = await executeQuery<{ status: InvitationClaimStatus }>(
    executor,
    sql`select get_invitation_claim_status(invitation) as status
        from pending_invitations invitation
        where invitation.id = ${invitation.id}`,
  );
  return current.rows[0]?.status ?? 'revoked';
}

export async function ensureCanManageInvitation(
  executor: QueryExecutor,
  invitation: InvitationRecord,
  actorId: string,
): Promise<void> {
  if (invitation.target_type === 'workspace') {
    if (invitation.target_id !== actorId || invitation.invited_by !== actorId) {
      throw new HTTPException(403, { message: 'Only the Owner can manage this invitation' });
    }
    return;
  }
  const access = await ensureCanAdminEntity(
    invitation.target_type,
    invitation.target_id,
    actorId,
    executor,
  );
  if (invitation.permission === 'admin' && !access.fullAccess) {
    throw new HTTPException(403, { message: 'Only the Owner can manage Admin invitations' });
  }
}

/**
 * Resolve status for a command that already owns the invitation target and
 * row locks. Access-change transactions normally persist revocation at commit;
 * this also handles invalid legacy/directly imported rows on write commands.
 * Callers must commit this resolution before returning an HTTP error.
 */
export async function resolveInvitationCommandStatus(
  executor: QueryExecutor,
  invitation: InvitationRecord,
): Promise<InvitationClaimStatus> {
  const status = await invitationClaimStatus(invitation, executor);
  if (
    status === 'revoked' &&
    (invitation.status === 'pending' || invitation.status === 'superseded')
  ) {
    await transitionInvitationLifecycle(executor, invitation.id, { status: 'revoked' });
  }
  return status;
}

export async function transitionInvitationLifecycle(
  executor: QueryExecutor,
  invitationId: string,
  resolution: InvitationResolution,
): Promise<InvitationRecord> {
  const acceptedBy = resolution.status === 'accepted' ? resolution.userId : null;
  const result = await executeQuery<InvitationRecord>(
    executor,
    sql`update pending_invitations
        set status = ${resolution.status}, resolved_at = now(),
            accepted_by = ${acceptedBy}, updated_at = now()
        where id = ${invitationId}
        returning *`,
  );
  const invitation = result.rows[0];
  if (!invitation) throw new Error('Invitation lifecycle transition returned no row');
  return invitation;
}

export async function supersedeMatchingPendingInvitations(
  executor: QueryExecutor,
  params: {
    targetType: InvitationTargetType;
    targetId: string;
    email: string;
  },
): Promise<void> {
  await executeQuery(
    executor,
    sql`update pending_invitations
        set status = 'superseded', resolved_at = now(), accepted_by = null, updated_at = now()
        where target_type = ${params.targetType} and target_id = ${params.targetId}
          and email = ${params.email} and status = 'pending' and expires_at > now()`,
  );
}

export function toPendingInvitation(
  row: InvitationRecord,
  canManage: boolean,
  deliveryStatus: InvitationDeliveryStatus,
): PendingInvitation {
  const base = {
    id: row.id,
    targetId: row.target_id,
    email: row.email,
    canManage,
    deliveryStatus,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
  return row.target_type === 'workspace'
    ? { ...base, targetType: 'workspace', permission: row.permission }
    : { ...base, targetType: row.target_type, permission: row.permission };
}

export async function preparePendingInvitation(
  executor: QueryExecutor,
  params: InvitationPreparationParams,
): Promise<InvitationPreparation> {
  const current = await executeQuery<InvitationRecord>(
    executor,
    sql`select * from pending_invitations
        where target_type = ${params.targetType} and target_id = ${params.targetId}
          and email = ${params.email}
        for update`,
  );
  const existing = current.rows[0];
  const existingPending =
    existing && (await invitationClaimStatus(existing, executor)) === 'pending';
  if (existingPending) {
    await ensureCanManageInvitation(executor, existing, params.invitedBy);
  }
  // A delivered link must never gain a different permission before its
  // replacement email arrives. Resending an unchanged invitation can reuse it.
  const reuseExistingToken =
    existingPending &&
    existing.invited_by === params.invitedBy &&
    existing.permission === params.permission;
  const token = reuseExistingToken ? null : randomBytes(32).toString('base64url');
  const hash = token ? hashInvitationToken(token) : existing?.token_hash;
  if (!hash) throw new Error('Invitation preparation did not produce a token hash');
  const result = await executeQuery<InvitationRecord>(
    executor,
    existing
      ? sql`update pending_invitations
            set permission = ${params.permission}, invited_by = ${params.invitedBy},
                token_hash = ${hash}, expires_at = now() + interval '7 days',
                status = 'pending', resolved_at = null, accepted_by = null, updated_at = now()
            where id = ${existing.id}
            returning *`
      : sql`insert into pending_invitations
            (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
          values (${params.targetType}, ${params.targetId}, ${params.email}, ${params.permission},
                  ${params.invitedBy}, ${hash}, now() + interval '7 days')
          returning *`,
  );
  const invitation = result.rows[0];
  if (!invitation) throw new Error('Invitation write returned no row');
  return { invitation, token };
}

export function listPendingInvitations(
  targetType: 'workspace',
  targetId: string,
  executor: QueryExecutor,
  management: { actorId: string; fullAccess: boolean },
): Promise<Array<Extract<PendingInvitation, { targetType: 'workspace' }>>>;
export function listPendingInvitations(
  targetType: ShareEntityType,
  targetId: string,
  executor: QueryExecutor,
  management: { actorId: string; fullAccess: boolean },
): Promise<Array<Extract<PendingInvitation, { targetType: ShareEntityType }>>>;
export async function listPendingInvitations(
  targetType: InvitationTargetType,
  targetId: string,
  executor: QueryExecutor,
  management: { actorId: string; fullAccess: boolean },
): Promise<PendingInvitation[]> {
  const result = await executeQuery<
    InvitationRecord & { delivery_status: InvitationDeliveryStatus }
  >(
    executor,
    sql`select invitation.*,
               case
                 when delivery.status = 'failed' then 'failed'
                 when delivery.status = 'sent' then 'sent'
                 else 'pending'
               end as delivery_status
        from pending_invitations invitation
        left join lateral (
          select status
          from invitation_send_attempts
          where invitation_id = invitation.id
          order by (status in ('pending', 'processing')) desc, attempted_at desc, id desc
          limit 1
        ) delivery on true
        where invitation.target_type = ${targetType} and invitation.target_id = ${targetId}
          and invitation.status = 'pending' and invitation.expires_at > now()
          and get_invitation_claim_status(invitation) = 'pending'
        order by invitation.created_at asc`,
  );
  return result.rows.map((invitation) =>
    toPendingInvitation(
      invitation,
      invitation.target_type === 'workspace'
        ? invitation.target_id === management.actorId &&
            invitation.invited_by === management.actorId
        : invitation.permission !== 'admin' || management.fullAccess,
      invitation.delivery_status,
    ),
  );
}

export async function findInvitationById(
  id: string,
  executor: QueryExecutor = db,
): Promise<InvitationRecord | null> {
  const result = await executeQuery<InvitationRecord>(
    executor,
    sql`select * from pending_invitations where id = ${id} limit 1`,
  );
  return result.rows[0] ?? null;
}

export async function findInvitationByToken(
  token: string,
  executor: QueryExecutor = db,
): Promise<InvitationRecord | null> {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) return null;
  const result = await executeQuery<InvitationRecord>(
    executor,
    sql`select * from pending_invitations
        where token_hash = ${hashInvitationToken(token)} limit 1`,
  );
  return result.rows[0] ?? null;
}
