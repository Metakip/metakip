import type { SharedWithMeItem } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { requireAuth } from '../middleware/auth';
import { grantOrInviteEntity } from '../utils/invitationAccess';
import { parseJsonRequestBody } from '../utils/requestBody';
import {
  parseEntityType,
  parsePermission,
  parsePublicPermission,
  type ShareEntityType,
  type SharePermission,
} from '../utils/share-access';
import {
  getShareSummary,
  revokeShareGrant,
  updatePublicAccess,
  updateShareGrantPermission,
  updateSharingInheritance,
} from '../utils/shareManagement';

type SharedRootRow = {
  id: string;
  entity_type: ShareEntityType;
  entity_id: string;
  permission: SharePermission;
  recipient_user_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  recipient_avatar_url: string | null;
  shared_by_name: string | null;
  shared_by_email: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  entity_title: string;
  entity_icon: string | null;
  owner_id: string | null;
  entity_updated_at: Date | null;
  sort_at: Date | null;
  source: 'direct' | 'public';
};

type SharedNavigationPage = {
  entityType: 'page';
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  ownerId: string | null;
  createdBy: string | null;
  updatedAt: Date | null;
  userPermission: SharePermission | null;
  source?: 'direct' | 'public';
  sortAt?: Date | null;
};

type SharedNavigationFolder = {
  entityType: 'folder';
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  ownerId: string | null;
  createdBy: string | null;
  updatedAt: Date | null;
  userPermission: SharePermission | null;
  source?: 'direct' | 'public';
  sortAt?: Date | null;
  children: SharedNavigationItem[];
};

type SharedNavigationItem = SharedNavigationPage | SharedNavigationFolder;

const sharesRoute = new Hono();
sharesRoute.use('*', requireAuth);

const timestampValue = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

async function removeNestedSharedRoots(
  rows: SharedRootRow[],
  executor: QueryExecutor,
): Promise<SharedRootRow[]> {
  const folderRootIds = rows
    .filter((row) => row.entity_type === 'folder')
    .map((row) => row.entity_id);
  if (folderRootIds.length === 0 || rows.length < 2) return rows;

  const pageIds = rows.filter((row) => row.entity_type === 'page').map((row) => row.entity_id);
  const folderIds = rows.filter((row) => row.entity_type === 'folder').map((row) => row.entity_id);
  const hiddenResult = await executeQuery<{ entity_type: ShareEntityType; entity_id: string }>(
    executor,
    sql`with folder_roots as (
       select distinct unnest(${sql.param(folderRootIds)}::uuid[]) as folder_id
     ), page_items as (
       select id, parent_id from pages where id = any(${sql.param(pageIds)}::uuid[]) and is_deleted = false
     ), folder_items as (
       select id from folders where id = any(${sql.param(folderIds)}::uuid[]) and is_deleted = false
     )
     select distinct 'page'::text as entity_type, page.id as entity_id
     from page_items page
     join folder_closure path on path.descendant_id = page.parent_id
     join folder_roots root on root.folder_id = path.ancestor_id
     where not is_page_folder_inheritance_blocked(root.folder_id, page.id)

     union

     select distinct 'folder'::text, folder.id
     from folder_items folder
     join folder_closure path on path.descendant_id = folder.id and path.depth > 0
     join folder_roots root on root.folder_id = path.ancestor_id
     where not is_folder_inheritance_blocked(root.folder_id, folder.id)`,
  );
  const hidden = new Set(hiddenResult.rows.map((row) => `${row.entity_type}:${row.entity_id}`));
  return rows.filter((row) => !hidden.has(`${row.entity_type}:${row.entity_id}`));
}

async function getSharedRoots(userId: string, executor: QueryExecutor): Promise<SharedRootRow[]> {
  const result = await executeQuery<SharedRootRow>(
    executor,
    sql`with candidates as (
       select share.id, share.entity_type, share.entity_id, access.permission,
              share.recipient_user_id, recipient.email as recipient_email,
              recipient.name as recipient_name,
              coalesce(recipient.avatar_url, recipient.image) as recipient_avatar_url,
              sharer.name as shared_by_name, sharer.email as shared_by_email,
              share.created_at, share.updated_at,
              case when share.entity_type = 'folder' then folder.name else page.title end as entity_title,
              case when share.entity_type = 'folder' then folder.icon else page.icon end as entity_icon,
              case when share.entity_type = 'folder' then get_root_folder_owner(folder.id)
                   else coalesce(get_root_folder_owner(page.parent_id), page.created_by) end as owner_id,
              case when share.entity_type = 'folder' then folder.updated_at else page.updated_at end as entity_updated_at,
              greatest(coalesce(share.updated_at, share.created_at), page_visit.visited_at) as sort_at,
              'direct'::text as source,
              1 as source_rank
       from shares share
       left join pages page on share.entity_type = 'page' and page.id = share.entity_id and page.is_deleted = false
       left join folders folder on share.entity_type = 'folder' and folder.id = share.entity_id and folder.is_deleted = false
       join users recipient on recipient.id = share.recipient_user_id
       left join users sharer on sharer.id = share.shared_by
       left join page_visits page_visit on page_visit.page_id = page.id and page_visit.user_id = ${userId}
       join lateral (
         select permission from get_effective_page_permission(share.entity_id, ${userId})
         where share.entity_type = 'page'
         union all
         select permission from get_effective_folder_permission(share.entity_id, ${userId})
         where share.entity_type = 'folder'
       ) access on true
       where share.recipient_user_id = ${userId}
         and access.permission is not null
         and ((share.entity_type = 'page' and page.id is not null)
           or (share.entity_type = 'folder' and folder.id is not null))

       union all

       select visit.id, 'page', visit.page_id, access.permission,
              visit.user_id, users.email, users.name,
              coalesce(users.avatar_url, users.image), null, null,
              visit.first_seen_at, visit.last_seen_at,
              page.title, page.icon,
              coalesce(get_root_folder_owner(page.parent_id), page.created_by),
              page.updated_at, visit.last_seen_at, 'public', 2
       from page_public_access_visits visit
       join users on users.id = visit.user_id
       join pages page on page.id = visit.page_id and page.is_deleted = false
       join lateral get_effective_page_permission(page.id, ${userId}) access on true
       where visit.user_id = ${userId}
         and get_public_page_permission(page.id) is not null
         and access.permission is not null

       union all

       select visit.id, 'folder', visit.folder_id, access.permission,
              visit.user_id, users.email, users.name,
              coalesce(users.avatar_url, users.image), null, null,
              visit.first_seen_at, visit.last_seen_at,
              folder.name, folder.icon, get_root_folder_owner(folder.id),
              folder.updated_at, visit.last_seen_at, 'public', 2
       from folder_public_access_visits visit
       join users on users.id = visit.user_id
       join folders folder on folder.id = visit.folder_id and folder.is_deleted = false
       join lateral get_effective_folder_permission(folder.id, ${userId}) access on true
       where visit.user_id = ${userId}
         and get_public_folder_permission(folder.id) is not null
         and access.permission is not null
     )
     select distinct on (entity_type, entity_id)
            id, entity_type, entity_id, permission, recipient_user_id,
            recipient_email, recipient_name, recipient_avatar_url,
            shared_by_name, shared_by_email, created_at, updated_at,
            entity_title, entity_icon, owner_id, entity_updated_at, sort_at, source
     from candidates
     where owner_id is distinct from ${userId}
     order by entity_type, entity_id, source_rank, sort_at desc nulls last`,
  );
  const visibleRows = await removeNestedSharedRoots(result.rows, executor);
  return visibleRows.sort(
    (left, right) => timestampValue(right.sort_at) - timestampValue(left.sort_at),
  );
}

function rootToSharedItem(row: SharedRootRow): SharedWithMeItem {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    permission: row.permission,
    recipientUserId: row.recipient_user_id,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    recipientAvatarUrl: row.recipient_avatar_url,
    sharedByName: row.shared_by_name,
    sharedByEmail: row.shared_by_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.entity_title,
    icon: row.entity_icon,
    ownerId: row.owner_id,
    entityUpdatedAt: row.entity_updated_at,
    sortAt: row.sort_at,
    source: row.source,
  };
}

sharesRoute.get('/with-me', async (c) => {
  const user = c.get('user') as { id: string };
  const limitParam = c.req.query('limit');
  if (limitParam && !/^\d+$/.test(limitParam)) {
    throw new HTTPException(400, { message: 'limit must be a positive integer' });
  }
  const limit = limitParam ? Number(limitParam) : null;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new HTTPException(400, { message: 'limit must be a positive integer' });
  }
  const roots = await db.transaction((tx) => getSharedRoots(user.id, tx), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
  return c.json((limit ? roots.slice(0, limit) : roots).map(rootToSharedItem));
});

sharesRoute.get('/with-me/tree', async (c) => {
  const user = c.get('user') as { id: string };
  const limitParam = c.req.query('limit');
  if (limitParam && !/^\d+$/.test(limitParam)) {
    throw new HTTPException(400, { message: 'limit must be a positive integer' });
  }
  const limit = limitParam ? Number(limitParam) : null;
  if (limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new HTTPException(400, { message: 'limit must be a positive integer' });
  }
  const result = await db.transaction(
    async (tx) => {
      const allRoots = await getSharedRoots(user.id, tx);
      const roots = limit ? allRoots.slice(0, limit) : allRoots;
      const items: SharedNavigationItem[] = [];

      for (const root of roots) {
        if (root.entity_type === 'page') {
          items.push({
            entityType: 'page',
            id: root.entity_id,
            title: root.entity_title,
            icon: root.entity_icon,
            parentId: null,
            ownerId: root.owner_id,
            createdBy: null,
            updatedAt: root.entity_updated_at,
            userPermission: root.permission,
            source: root.source,
            sortAt: root.sort_at,
          });
          continue;
        }

        const folderResult = await executeQuery<{
          id: string;
          parent_id: string | null;
          name: string;
          icon: string | null;
          created_by: string | null;
          updated_at: Date | null;
          owner_id: string | null;
          permission: SharePermission | null;
        }>(
          tx,
          sql`select folder.id, folder.parent_id, folder.name, folder.icon,
                folder.created_by, folder.updated_at,
                get_root_folder_owner(folder.id) as owner_id, access.permission
         from folder_closure path
         join folders folder on folder.id = path.descendant_id and folder.is_deleted = false
         join lateral get_effective_folder_permission(folder.id, ${user.id}) access on true
         where path.ancestor_id = ${root.entity_id} and access.permission is not null
           order by path.depth, folder.position::numeric`,
        );
        const pageResult = await executeQuery<{
          id: string;
          parent_id: string | null;
          title: string;
          icon: string | null;
          created_by: string | null;
          updated_at: Date | null;
          owner_id: string | null;
          permission: SharePermission | null;
        }>(
          tx,
          sql`select page.id, page.parent_id, page.title, page.icon,
                page.created_by, page.updated_at,
                coalesce(get_root_folder_owner(page.parent_id), page.created_by) as owner_id,
                access.permission
         from pages page
         join folder_closure path on path.descendant_id = page.parent_id
         join lateral get_effective_page_permission(page.id, ${user.id}) access on true
         where path.ancestor_id = ${root.entity_id} and page.is_deleted = false
           and access.permission is not null
           order by path.depth, page.position::numeric`,
        );

        const folders = new Map<string, SharedNavigationFolder>();
        for (const row of folderResult.rows) {
          folders.set(row.id, {
            entityType: 'folder',
            id: row.id,
            title: row.name,
            icon: row.icon,
            parentId: row.id === root.entity_id ? null : row.parent_id,
            ownerId: row.owner_id,
            createdBy: row.created_by,
            updatedAt: row.updated_at,
            userPermission: row.permission,
            ...(row.id === root.entity_id ? { source: root.source, sortAt: root.sort_at } : {}),
            children: [],
          });
        }
        for (const folder of folders.values()) {
          if (folder.parentId && folders.has(folder.parentId)) {
            folders.get(folder.parentId)?.children.push(folder);
          }
        }
        for (const row of pageResult.rows) {
          const page: SharedNavigationPage = {
            entityType: 'page',
            id: row.id,
            title: row.title,
            icon: row.icon,
            parentId: row.parent_id,
            ownerId: row.owner_id,
            createdBy: row.created_by,
            updatedAt: row.updated_at,
            userPermission: row.permission,
          };
          folders.get(row.parent_id ?? '')?.children.push(page);
        }
        const rootFolder = folders.get(root.entity_id);
        if (rootFolder) items.push(rootFolder);
      }

      return items;
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );

  return c.json(result);
});

sharesRoute.get('/entity/:entityType/:entityId', async (c) => {
  const entityType = parseEntityType(c.req.param('entityType'));
  const entityId = c.req.param('entityId');
  const user = c.get('user') as { id: string };
  return c.json(await getShareSummary(entityType, entityId, user.id));
});

sharesRoute.patch('/entity/:entityType/:entityId/inheritance', async (c) => {
  const entityType = parseEntityType(c.req.param('entityType'));
  const entityId = c.req.param('entityId');
  const user = c.get('user') as { id: string };
  const body = await parseJsonRequestBody(c);
  const policy = body && typeof body === 'object' ? (body as { policy?: unknown }).policy : null;
  if (policy !== 'inherit' && policy !== 'restricted') {
    throw new HTTPException(400, { message: 'Invalid inheritance policy' });
  }

  return c.json(await updateSharingInheritance(entityType, entityId, user.id, policy));
});

sharesRoute.patch('/entity/:entityType/:entityId/public-access', async (c) => {
  const entityType = parseEntityType(c.req.param('entityType'));
  const entityId = c.req.param('entityId');
  const user = c.get('user') as { id: string };
  const body = await parseJsonRequestBody(c);
  const requestedPermission =
    body && typeof body === 'object' ? (body as { permission?: unknown }).permission : null;
  const permission =
    requestedPermission === 'private' ? null : parsePublicPermission(requestedPermission);
  return c.json(await updatePublicAccess(entityType, entityId, user.id, permission));
});

sharesRoute.post('/entity/:entityType/:entityId/grants', async (c) => {
  const entityType = parseEntityType(c.req.param('entityType'));
  const entityId = c.req.param('entityId');
  const user = c.get('user') as { id: string };
  const body = await parseJsonRequestBody(c);
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }
  const { email, permission } = body as { email?: unknown; permission?: unknown };
  if (typeof email !== 'string' || email.trim().length === 0) {
    throw new HTTPException(400, { message: 'Email is required' });
  }
  const nextPermission = parsePermission(permission);
  const result = await grantOrInviteEntity({
    actorId: user.id,
    targetType: entityType,
    targetId: entityId,
    email,
    permission: nextPermission,
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
  return c.json({ ok: true, message: result.message });
});

sharesRoute.patch('/grants/:grantId', async (c) => {
  const grantId = c.req.param('grantId');
  const user = c.get('user') as { id: string };
  const body = await parseJsonRequestBody(c);
  const permission = parsePermission(
    body && typeof body === 'object' ? (body as { permission?: unknown }).permission : null,
  );
  const result = await updateShareGrantPermission(grantId, user.id, permission);
  return c.json({ ok: true, message: result.message });
});

sharesRoute.delete('/grants/:grantId', async (c) => {
  const grantId = c.req.param('grantId');
  const user = c.get('user') as { id: string };
  const result = await revokeShareGrant(grantId, user.id);
  return c.json({ ok: true, message: result.message });
});

export default sharesRoute;
