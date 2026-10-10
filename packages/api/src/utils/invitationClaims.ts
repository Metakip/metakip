import {
  buildFolderPath,
  buildPagePath,
  getApiLogger,
  type InvitationClaim,
} from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import {
  acceptInvitedEntityGrant,
  addWorkspaceMember,
  workspaceRoleLabel,
} from './accessGrantMutations';
import { resolveInvitationPresentation } from './invitationPresentation';
import { completeOnboarding } from './onboarding';
import {
  findInvitationByToken,
  type InvitationRecord,
  invitationClaimStatus,
  resolveInvitationCommandStatus,
  transitionInvitationLifecycle,
  withLockedInvitationByToken,
} from './pendingInvitations';
import { recordWorkspaceAccessMutation } from './share-access';
import { resolveOwnedShareEntity } from './shareEntity';
import { ensureAccountSetupComplete } from './welcomePage';

function unavailableInvitationMessage(status: InvitationClaim['status']): string {
  if (status === 'declined') return 'Invitation was declined';
  if (status === 'revoked') return 'Invitation was revoked';
  if (status === 'superseded') return 'Invitation was replaced by direct access';
  if (status === 'expired') return 'Invitation has expired';
  return `Invitation is ${status}`;
}

async function acceptedDestination(
  invitation: InvitationRecord,
  executor: QueryExecutor,
): Promise<string> {
  if (invitation.target_type === 'workspace') return '/';
  const entity = await resolveOwnedShareEntity(
    invitation.target_type,
    invitation.target_id,
    executor,
  );
  return invitation.target_type === 'page'
    ? buildPagePath(entity.title, invitation.target_id)
    : buildFolderPath(entity.title, invitation.target_id);
}

export async function getInvitationClaim(token: string): Promise<InvitationClaim> {
  const snapshot = await db.transaction(
    async (tx) => {
      const invitation = await findInvitationByToken(token, tx);
      if (!invitation) throw new HTTPException(404, { message: 'Invitation not found' });
      const status = await invitationClaimStatus(invitation, tx);
      const presentation = await resolveInvitationPresentation(invitation, tx);
      return { invitation, presentation, status };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  const { invitation, presentation, status } = snapshot;
  const base = {
    status,
    targetTitle: presentation.targetTitle,
    inviterName: presentation.inviterName,
    email: invitation.email,
  };
  return invitation.target_type === 'workspace'
    ? { ...base, targetType: 'workspace', permission: invitation.permission }
    : { ...base, targetType: invitation.target_type, permission: invitation.permission };
}

export async function declineInvitation(token: string): Promise<void> {
  const unavailableStatus = await withLockedInvitationByToken(token, async (tx, invitation) => {
    const status = await resolveInvitationCommandStatus(tx, invitation);
    if (status === 'declined') return null;
    if (status !== 'pending') return status;
    await transitionInvitationLifecycle(tx, invitation.id, { status: 'declined' });
    return null;
  });
  if (unavailableStatus) {
    throw new HTTPException(410, { message: `Invitation is ${unavailableStatus}` });
  }
}

export async function acceptInvitation(
  token: string,
  userId: string,
  provisionWelcomePage: typeof ensureAccountSetupComplete = ensureAccountSetupComplete,
): Promise<string> {
  const outcome = await withLockedInvitationByToken(
    token,
    async (tx, invitation, targetOwnerId) => {
      const account = await executeQuery<{ email: string }>(
        tx,
        sql`select email from users where id = ${userId} limit 1`,
      );
      const email = account.rows[0]?.email;
      if (!email) throw new HTTPException(404, { message: 'User not found' });
      if (email.trim().toLowerCase() !== invitation.email) {
        throw new HTTPException(403, {
          message: 'Sign in with the invited email address to accept this invitation',
          cause: { code: 'INVITATION_EMAIL_MISMATCH' },
        });
      }

      const status = await resolveInvitationCommandStatus(tx, invitation);
      if (status === 'accepted' || status === 'superseded') {
        if (status === 'accepted' && invitation.accepted_by !== userId) {
          throw new HTTPException(409, { message: 'Invitation has already been accepted' });
        }
        await completeOnboarding(tx, userId);
        return {
          kind: 'accepted' as const,
          destination: await acceptedDestination(invitation, tx),
        };
      }
      if (status !== 'pending') {
        return { kind: 'unavailable' as const, status };
      }

      let destination = '/';
      if (invitation.target_type === 'workspace') {
        const inserted = await addWorkspaceMember(tx, {
          ownerId: invitation.target_id,
          memberId: userId,
          role: invitation.permission,
          message: `Joined workspace as ${workspaceRoleLabel(invitation.permission)}`,
        });
        if (inserted) await recordWorkspaceAccessMutation(tx, targetOwnerId);
      } else {
        const entity = await resolveOwnedShareEntity(
          invitation.target_type,
          invitation.target_id,
          tx,
        );
        const inserted = await acceptInvitedEntityGrant(tx, {
          actorId: invitation.invited_by,
          entityType: invitation.target_type,
          entityId: invitation.target_id,
          entityTitle: entity.title,
          permission: invitation.permission,
          recipientId: userId,
        });
        if (inserted) await recordWorkspaceAccessMutation(tx, targetOwnerId);
        destination =
          invitation.target_type === 'page'
            ? buildPagePath(entity.title, invitation.target_id)
            : buildFolderPath(entity.title, invitation.target_id);
      }

      await transitionInvitationLifecycle(tx, invitation.id, { status: 'accepted', userId });
      await completeOnboarding(tx, userId);
      return { kind: 'accepted' as const, destination };
    },
  );
  if (outcome.kind === 'unavailable') {
    throw new HTTPException(410, { message: unavailableInvitationMessage(outcome.status) });
  }
  // Optional content must never roll back granted access. Like signup, attempt
  // provisioning in its own transaction; a later acceptance can retry it.
  try {
    await db.transaction((tx) => provisionWelcomePage(tx, userId));
  } catch (error) {
    getApiLogger().error('Welcome page provisioning failed after invitation acceptance', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return outcome.destination;
}
