import type { WorkspaceRole } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, query } from '../db/query';
import { requireAuth } from '../middleware/auth';
import { grantOrInviteWorkspaceMember } from '../utils/invitationAccess';
import { listPendingInvitations } from '../utils/pendingInvitations';
import { parseJsonRequestBody } from '../utils/requestBody';
import { lockWorkspaceAccess } from '../utils/share-access';
import {
  leaveWorkspace,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from '../utils/workspaceSharing';

const workspaceRoute = new Hono();

workspaceRoute.use('*', requireAuth);

const parseWorkspaceRole = (value: unknown, defaultRole?: WorkspaceRole): WorkspaceRole => {
  if (value === undefined && defaultRole) return defaultRole;
  if (value === 'viewer' || value === 'commenter' || value === 'editor' || value === 'admin') {
    return value;
  }
  throw new HTTPException(400, { message: 'Invalid workspace role' });
};

/**
 * GET /workspace/memberships — list workspaces the caller has joined.
 */
workspaceRoute.get('/memberships', async (c) => {
  const user = c.get('user') as { id: string };
  const result = await query(
    sql`select wm.workspace_owner_id as "ownerId",
            owner.name as "ownerName",
            wm.role,
            wm.created_at as "joinedAt"
     from workspace_members wm
     join users owner on owner.id = wm.workspace_owner_id
     where wm.member_id = ${user.id}
     order by wm.created_at asc`,
  );
  return c.json(result.rows);
});

/**
 * GET /workspace/members — list all members of the caller's workspace
 * Only the workspace owner can list members.
 */
workspaceRoute.get('/members', async (c) => {
  const user = c.get('user') as { id: string };
  const snapshot = await db.transaction(async (tx) => {
    await lockWorkspaceAccess(tx, user.id);
    const result = await executeQuery(
      tx,
      sql`SELECT
         wm.id,
         wm.workspace_owner_id AS "workspaceOwnerId",
         wm.member_id AS "memberId",
         u.name AS "memberName",
         u.email AS "memberEmail",
         u.avatar_url AS "memberAvatarUrl",
         wm.role,
         wm.created_at AS "createdAt"
       FROM workspace_members wm
       JOIN users u ON u.id = wm.member_id
       WHERE wm.workspace_owner_id = ${user.id}
       ORDER BY wm.created_at ASC`,
    );
    return {
      members: result.rows,
      pendingInvitations: await listPendingInvitations('workspace', user.id, tx, {
        actorId: user.id,
        fullAccess: true,
      }),
    };
  });
  return c.json(snapshot);
});

/**
 * POST /workspace/members/invite — invite a user to the caller's workspace
 * Only the workspace owner or an admin can invite members.
 */
workspaceRoute.post('/members/invite', async (c) => {
  const user = c.get('user') as { id: string };
  const body = await parseJsonRequestBody(c);
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }

  const { email, role: rawRole } = body as { email?: string; role?: string };
  if (!email || typeof email !== 'string') {
    throw new HTTPException(400, { message: 'Email is required' });
  }

  const role = parseWorkspaceRole(rawRole, 'editor');
  const result = await grantOrInviteWorkspaceMember({
    ownerId: user.id,
    actorId: user.id,
    email,
    role,
  });
  if (result.kind === 'invitation') {
    return c.json(
      {
        ok: true,
        invitation: result.invitation,
        message: `Invitation queued for ${result.invitation.email}`,
      },
      202,
    );
  }
  return c.json({
    ok: true,
    memberId: result.recipientId,
    name: result.recipientName,
    message: result.message,
  });
});

/**
 * PATCH /workspace/members/:memberId/role — change a member's role
 * Only the workspace owner can change roles.
 */
workspaceRoute.patch('/members/:memberId/role', async (c) => {
  const user = c.get('user') as { id: string };
  const memberId = c.req.param('memberId');
  const body = await parseJsonRequestBody(c);
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }

  const { role: rawRole } = body as { role?: string };
  const role = parseWorkspaceRole(rawRole);
  const result = await updateWorkspaceMemberRole(user.id, memberId, role);
  return c.json({ ok: true, message: result.message });
});

/**
 * DELETE /workspace/members/:memberId — remove a member from the workspace
 * The owner can remove anyone. A member can remove themselves (leave).
 */
workspaceRoute.delete('/members/:memberId', async (c) => {
  const user = c.get('user') as { id: string };
  const memberId = c.req.param('memberId');

  const isSelfRemoval = user.id === memberId;
  const workspaceOwnerId = isSelfRemoval ? c.req.query('workspaceOwnerId') : user.id;
  if (!workspaceOwnerId) {
    throw new HTTPException(400, { message: 'workspaceOwnerId is required to leave a workspace' });
  }
  if (isSelfRemoval && workspaceOwnerId === user.id) {
    throw new HTTPException(400, { message: 'Cannot leave your own workspace' });
  }

  if (!isSelfRemoval) {
    // Keep the legacy 403 response for unknown members; v1 reports 404.
    const ownerCheck = await query(
      sql`SELECT id FROM workspace_members WHERE workspace_owner_id = ${workspaceOwnerId} AND member_id = ${memberId} LIMIT 1`,
    );
    if (!ownerCheck.rowCount || ownerCheck.rowCount === 0) {
      throw new HTTPException(403, { message: 'Only the workspace owner can remove members' });
    }
  }

  const result = isSelfRemoval
    ? await leaveWorkspace(user.id, workspaceOwnerId)
    : await removeWorkspaceMember(user.id, memberId);
  return c.json({ ok: true, message: result.message });
});

export default workspaceRoute;
