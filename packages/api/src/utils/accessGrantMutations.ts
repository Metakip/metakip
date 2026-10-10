import type { ShareEntityType, SharePermission, WorkspaceRole } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { executeQuery, type QueryExecutor } from '../db/query';
import { supersedeMatchingPendingInvitations } from './pendingInvitations';
import { notifyShareGrant, notifyShareUpdate, notifyWorkspaceEvent } from './share-notify';

export const entityPermissionLabel = (
  permission: SharePermission,
): 'Admin' | 'Editor' | 'Commenter' | 'Viewer' =>
  permission === 'admin'
    ? 'Admin'
    : permission === 'edit'
      ? 'Editor'
      : permission === 'commenter'
        ? 'Commenter'
        : 'Viewer';

export const workspaceRoleLabel = (role: WorkspaceRole): 'Admin' | 'Editor' | 'Viewer' =>
  role === 'admin' ? 'Admin' : role === 'editor' ? 'Editor' : 'Viewer';

type EntityGrant = {
  actorId: string;
  actorName: string;
  entityId: string;
  entityTitle: string;
  entityType: ShareEntityType;
  permission: SharePermission;
  recipientId: string;
};

async function insertEntityGrant(executor: QueryExecutor, grant: EntityGrant): Promise<boolean> {
  const inserted = await executeQuery(
    executor,
    sql`insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
        values (${grant.entityType}, ${grant.entityId}, ${grant.actorId},
                ${grant.recipientId}, ${grant.permission})
        on conflict (entity_type, entity_id, recipient_user_id) do nothing
        returning id`,
  );
  if (!inserted.rowCount) return false;
  await notifyShareGrant(
    {
      entityType: grant.entityType,
      entityId: grant.entityId,
      permission: grant.permission,
      targetUserId: grant.recipientId,
      entityTitle: grant.entityTitle,
      sharedByName: grant.actorName,
    },
    executor,
  );
  return true;
}

export async function acceptInvitedEntityGrant(
  executor: QueryExecutor,
  grant: Omit<EntityGrant, 'actorName'>,
): Promise<boolean> {
  const inviter = await executeQuery<{ name: string | null }>(
    executor,
    sql`select name from users where id = ${grant.actorId}`,
  );
  return insertEntityGrant(executor, {
    ...grant,
    actorName: inviter.rows[0]?.name ?? 'Someone',
  });
}

export async function setEntityGrant(
  executor: QueryExecutor,
  grant: EntityGrant & { actorFullAccess: boolean; recipientEmail: string },
): Promise<'created' | 'updated'> {
  const existing = await executeQuery<{ id: string; permission: SharePermission }>(
    executor,
    sql`select id, permission from shares
        where entity_type = ${grant.entityType} and entity_id = ${grant.entityId}
          and recipient_user_id = ${grant.recipientId}
        for update`,
  );
  const current = existing.rows[0];
  if (current?.permission === 'admin' && !grant.actorFullAccess) {
    throw new HTTPException(403, { message: 'Only the Owner can change an Admin' });
  }

  let result: 'created' | 'updated';
  if (current) {
    await executeQuery(
      executor,
      sql`update shares set permission = ${grant.permission}, shared_by = ${grant.actorId},
          updated_at = now() where id = ${current.id}`,
    );
    await notifyShareUpdate(
      {
        entityType: grant.entityType,
        entityId: grant.entityId,
        permission: grant.permission,
        targetUserId: grant.recipientId,
        entityTitle: grant.entityTitle,
        sharedByName: grant.actorName,
      },
      executor,
    );
    result = 'updated';
  } else {
    if (!(await insertEntityGrant(executor, grant))) {
      throw new Error('Entity grant changed outside the access mutation lock');
    }
    result = 'created';
  }

  await supersedeMatchingPendingInvitations(executor, {
    targetType: grant.entityType,
    targetId: grant.entityId,
    email: grant.recipientEmail,
  });
  return result;
}

export async function addWorkspaceMember(
  executor: QueryExecutor,
  params: {
    memberId: string;
    message: string;
    ownerId: string;
    role: WorkspaceRole;
  },
): Promise<boolean> {
  const inserted = await executeQuery(
    executor,
    sql`insert into workspace_members (workspace_owner_id, member_id, role)
        values (${params.ownerId}, ${params.memberId}, ${params.role})
        on conflict (workspace_owner_id, member_id) do nothing
        returning id`,
  );
  if (!inserted.rowCount) return false;
  await notifyWorkspaceEvent(
    'member_added',
    params.ownerId,
    params.memberId,
    params.message,
    executor,
  );
  return true;
}
