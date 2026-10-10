import type {
  PendingInvitation,
  ShareEntityType,
  SharePermission,
  WorkspaceRole,
} from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery } from '../db/query';
import {
  addWorkspaceMember,
  entityPermissionLabel,
  setEntityGrant,
  workspaceRoleLabel,
} from './accessGrantMutations';
import { enqueueInvitationResend, prepareAndEnqueueInvitation } from './invitationDelivery';
import {
  ensureCanManageInvitation,
  type InvitationRecord,
  normalizeInvitationEmail,
  resolveInvitationCommandStatus,
  supersedeMatchingPendingInvitations,
  toPendingInvitation,
  transitionInvitationLifecycle,
  withLockedInvitationById,
} from './pendingInvitations';
import {
  ensureCanAdminEntity,
  lockEntityAccessExclusive,
  lockWorkspaceAccessExclusive,
  recordWorkspaceAccessMutation,
} from './share-access';
import { resolveOwnedShareEntity } from './shareEntity';

type GrantOrInviteResult =
  | { kind: 'invitation'; invitation: PendingInvitation }
  | { kind: 'grant'; recipientId: string; recipientName: string | null; message: string };

export async function grantOrInviteEntity(params: {
  actorId: string;
  targetType: ShareEntityType;
  targetId: string;
  email: string;
  permission: SharePermission;
}): Promise<GrantOrInviteResult> {
  const email = normalizeInvitationEmail(params.email);
  const outcome = await db.transaction(async (tx) => {
    const workspaceOwnerId = await lockEntityAccessExclusive(
      tx,
      params.targetType,
      params.targetId,
    );
    const actorAccess = await ensureCanAdminEntity(
      params.targetType,
      params.targetId,
      params.actorId,
      tx,
    );
    if (params.permission === 'admin' && !actorAccess.fullAccess) {
      throw new HTTPException(403, { message: 'Only the Owner can grant Admin access' });
    }
    const entity = await resolveOwnedShareEntity(params.targetType, params.targetId, tx);
    const recipientResult = await executeQuery<{
      id: string;
      email: string;
      name: string | null;
    }>(tx, sql`select id, email, name from users where lower(email) = ${email} limit 1`);
    const recipient = recipientResult.rows[0];
    if (!recipient) {
      const queued = await prepareAndEnqueueInvitation(tx, {
        targetType: params.targetType,
        targetId: params.targetId,
        email,
        permission: params.permission,
        invitedBy: params.actorId,
      });
      return { kind: 'invitation' as const, queued };
    }
    if (recipient.id === params.actorId) {
      throw new HTTPException(400, { message: 'Cannot share with yourself' });
    }
    if (recipient.id === entity.ownerId) {
      throw new HTTPException(400, { message: 'Owner already has full access' });
    }

    const sharer = await executeQuery<{ name: string | null }>(
      tx,
      sql`select name from users where id = ${params.actorId}`,
    );
    const grantResult = await setEntityGrant(tx, {
      actorId: params.actorId,
      actorName: sharer.rows[0]?.name ?? 'Someone',
      actorFullAccess: actorAccess.fullAccess,
      entityType: params.targetType,
      entityId: params.targetId,
      entityTitle: entity.title,
      permission: params.permission,
      recipientId: recipient.id,
      recipientEmail: email,
    });
    await recordWorkspaceAccessMutation(tx, workspaceOwnerId);
    return {
      kind: 'grant' as const,
      recipientId: recipient.id,
      recipientName: recipient.name,
      message:
        grantResult === 'updated'
          ? `Updated ${recipient.email}'s access to ${entityPermissionLabel(params.permission)} on ${entity.title}`
          : `Granted ${entityPermissionLabel(params.permission)} access to ${recipient.email} on ${entity.title}`,
    };
  });

  if (outcome.kind === 'grant') return outcome;
  return {
    kind: 'invitation',
    invitation: toPendingInvitation(outcome.queued.invitation, true, 'pending'),
  };
}

export async function grantOrInviteWorkspaceMember(params: {
  ownerId: string;
  actorId: string;
  email: string;
  role: WorkspaceRole;
}): Promise<GrantOrInviteResult> {
  const email = normalizeInvitationEmail(params.email);
  const outcome = await db.transaction(async (tx) => {
    await lockWorkspaceAccessExclusive(tx, params.ownerId);
    if (params.actorId !== params.ownerId) {
      throw new HTTPException(403, { message: 'Only the Owner can invite workspace members' });
    }
    const target = await executeQuery<{ id: string; name: string | null; email: string }>(
      tx,
      sql`select id, name, email from users where lower(email) = ${email} limit 1`,
    );
    const recipient = target.rows[0];
    if (!recipient) {
      const queued = await prepareAndEnqueueInvitation(tx, {
        targetType: 'workspace',
        targetId: params.ownerId,
        email,
        permission: params.role,
        invitedBy: params.actorId,
      });
      return { kind: 'invitation' as const, queued };
    }
    if (recipient.id === params.ownerId) {
      throw new HTTPException(400, { message: 'Cannot invite yourself' });
    }
    const message = `Added ${recipient.name ?? recipient.email} as ${workspaceRoleLabel(params.role)} to workspace`;
    const inserted = await addWorkspaceMember(tx, {
      ownerId: params.ownerId,
      memberId: recipient.id,
      role: params.role,
      message,
    });
    if (!inserted) {
      throw new HTTPException(409, { message: 'User is already a workspace member' });
    }
    await recordWorkspaceAccessMutation(tx, params.ownerId);
    await supersedeMatchingPendingInvitations(tx, {
      targetType: 'workspace',
      targetId: params.ownerId,
      email,
    });
    return {
      kind: 'grant' as const,
      recipientId: recipient.id,
      recipientName: recipient.name,
      message,
    };
  });

  if (outcome.kind === 'grant') return outcome;
  return {
    kind: 'invitation',
    invitation: toPendingInvitation(outcome.queued.invitation, true, 'pending'),
  };
}

export async function resendManagedInvitation(
  invitationId: string,
  actorId: string,
): Promise<PendingInvitation> {
  const outcome = await withLockedInvitationById(invitationId, async (tx, invitation) => {
    await ensureCanManageInvitation(tx, invitation, actorId);
    const status = await resolveInvitationCommandStatus(tx, invitation);
    return status === 'pending'
      ? { kind: 'queued' as const, prepared: await enqueueInvitationResend(tx, invitation) }
      : { kind: 'unavailable' as const, status };
  });
  if (outcome.kind === 'unavailable') {
    throw new HTTPException(409, { message: `Invitation is ${outcome.status}` });
  }
  return toPendingInvitation(outcome.prepared.invitation, true, 'pending');
}

export async function revokeManagedInvitation(
  invitationId: string,
  actorId: string,
): Promise<InvitationRecord> {
  const outcome = await withLockedInvitationById(invitationId, async (tx, invitation) => {
    await ensureCanManageInvitation(tx, invitation, actorId);
    const status = await resolveInvitationCommandStatus(tx, invitation);
    if (status !== 'pending') {
      return { kind: 'unavailable' as const, status };
    }
    return {
      kind: 'revoked' as const,
      invitation: await transitionInvitationLifecycle(tx, invitation.id, { status: 'revoked' }),
    };
  });
  if (outcome.kind === 'unavailable') {
    throw new HTTPException(409, { message: `Invitation is ${outcome.status}` });
  }
  return outcome.invitation;
}
