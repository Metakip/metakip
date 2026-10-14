import type { WorkspaceRole } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { listPendingInvitations, normalizeInvitationEmail } from './pendingInvitations';
import { lockWorkspaceAccess, lockWorkspaceAccessMutation } from './share-access';
import { notifyWorkspaceEvent } from './share-notify';
import { toIsoTimestamp } from './toIsoTimestamp';

type WorkspaceMemberSummaryRow = {
  id: string;
  workspaceOwnerId: string;
  memberId: string;
  memberName: string | null;
  memberEmail: string;
  memberAvatarUrl: string | null;
  role: WorkspaceRole;
  createdAt: Date | string;
};

type WorkspaceMembershipSummaryRow = {
  ownerId: string;
  ownerName: string | null;
  role: WorkspaceRole;
  joinedAt: Date | string;
};

export async function getWorkspaceSharingSummary(ownerId: string) {
  return db.transaction(async (tx) => {
    await lockWorkspaceAccess(tx, ownerId);
    const ownerResult = await executeQuery<{ id: string; name: string | null }>(
      tx,
      sql`select id, name from users where id = ${ownerId}`,
    );
    const memberResult = await executeQuery<WorkspaceMemberSummaryRow>(
      tx,
      sql`select wm.id,
                 wm.workspace_owner_id as "workspaceOwnerId",
                 wm.member_id as "memberId",
                 u.name as "memberName",
                 u.email as "memberEmail",
                 u.avatar_url as "memberAvatarUrl",
                 wm.role,
                 wm.created_at as "createdAt"
          from workspace_members wm
          join users u on u.id = wm.member_id
          where wm.workspace_owner_id = ${ownerId}
          order by wm.created_at asc`,
    );
    const membershipResult = await executeQuery<WorkspaceMembershipSummaryRow>(
      tx,
      sql`select wm.workspace_owner_id as "ownerId",
                 owner.name as "ownerName",
                 wm.role,
                 wm.created_at as "joinedAt"
          from workspace_members wm
          join users owner on owner.id = wm.workspace_owner_id
          where wm.member_id = ${ownerId}
          order by wm.created_at asc`,
    );
    const pendingInvitations = await listPendingInvitations('workspace', ownerId, tx, {
      actorId: ownerId,
      fullAccess: true,
    });

    return {
      ownerId,
      ownerName: ownerResult.rows[0]?.name ?? null,
      members: memberResult.rows.map((member) => ({
        ...member,
        createdAt: toIsoTimestamp(member.createdAt),
      })),
      memberships: membershipResult.rows.map((membership) => ({
        ...membership,
        joinedAt: toIsoTimestamp(membership.joinedAt),
      })),
      pendingInvitations,
    };
  });
}

type MemberSelector = { memberId: string } | { email: string };

async function lockWorkspaceMember(
  tx: QueryExecutor,
  ownerId: string,
  selector: MemberSelector,
): Promise<{ memberId: string; name: string | null }> {
  const matching =
    'memberId' in selector
      ? sql`wm.member_id = ${selector.memberId}`
      : sql`lower(u.email) = ${selector.email}`;
  const result = await executeQuery<{ memberId: string; name: string | null }>(
    tx,
    sql`select wm.member_id as "memberId", u.name
        from workspace_members wm
        join users u on u.id = wm.member_id
        where wm.workspace_owner_id = ${ownerId} and ${matching}
        for update of wm`,
  );
  if (result.rows.length > 1) {
    throw new HTTPException(409, { message: 'More than one workspace member matches this email' });
  }
  const member = result.rows[0];
  if (!member) {
    if ('email' in selector) {
      const pending = await executeQuery(
        tx,
        sql`select 1 from pending_invitations invitation
            where invitation.target_type = 'workspace' and invitation.target_id = ${ownerId}
              and invitation.email = ${selector.email}
              and get_invitation_claim_status(invitation) = 'pending'`,
      );
      if (pending.rows.length > 0) {
        throw new HTTPException(409, {
          message: 'This person has a pending invitation; use resend or cancel instead',
        });
      }
    }
    throw new HTTPException(404, { message: 'Member not found' });
  }
  return member;
}

async function changeWorkspaceMemberRole(
  ownerId: string,
  selector: MemberSelector,
  role: WorkspaceRole,
): Promise<{ message: string }> {
  return db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, ownerId);
    const member = await lockWorkspaceMember(tx, ownerId, selector);
    const message = `Changed ${member.name ?? 'Member'}'s role to ${role}`;
    await executeQuery(
      tx,
      sql`update workspace_members set role = ${role}
          where workspace_owner_id = ${ownerId} and member_id = ${member.memberId}`,
    );
    await notifyWorkspaceEvent('role_changed', ownerId, member.memberId, message, tx);
    return { message };
  });
}

export function updateWorkspaceMemberRole(ownerId: string, memberId: string, role: WorkspaceRole) {
  return changeWorkspaceMemberRole(ownerId, { memberId }, role);
}

export function updateWorkspaceMemberRoleByEmail(
  ownerId: string,
  email: string,
  role: WorkspaceRole,
) {
  return changeWorkspaceMemberRole(ownerId, { email: normalizeInvitationEmail(email) }, role);
}

async function removeMatchingWorkspaceMember(
  ownerId: string,
  selector: MemberSelector,
): Promise<{ message: string }> {
  return db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, ownerId);
    const member = await lockWorkspaceMember(tx, ownerId, selector);
    const message = `Removed ${member.name ?? 'Member'} from workspace`;
    await executeQuery(
      tx,
      sql`delete from workspace_members
          where workspace_owner_id = ${ownerId} and member_id = ${member.memberId}`,
    );
    await notifyWorkspaceEvent('member_removed', ownerId, member.memberId, message, tx);
    return { message };
  });
}

export function removeWorkspaceMember(ownerId: string, memberId: string) {
  return removeMatchingWorkspaceMember(ownerId, { memberId });
}

export function removeWorkspaceMemberByEmail(ownerId: string, email: string) {
  return removeMatchingWorkspaceMember(ownerId, { email: normalizeInvitationEmail(email) });
}

export async function leaveWorkspace(
  memberId: string,
  ownerId: string,
): Promise<{ message: string }> {
  if (ownerId === memberId) {
    throw new HTTPException(400, { message: 'Cannot leave your own workspace' });
  }
  const message = 'Left the workspace';

  await db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, ownerId);
    const deleteResult = await executeQuery(
      tx,
      sql`delete from workspace_members
          where workspace_owner_id = ${ownerId} and member_id = ${memberId}
          returning id`,
    );
    if (!deleteResult.rowCount) {
      throw new HTTPException(404, { message: 'Member not found' });
    }
    await notifyWorkspaceEvent('member_removed', ownerId, memberId, message, tx);
  });

  return { message };
}
