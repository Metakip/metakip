import {
  buildFolderPath as buildSharedFolderPath,
  buildPagePath as buildSharedPagePath,
  deriveCapabilities,
  type EntityAccessSource,
  type EntityShare,
  type InheritedPublicAccess,
  type SharedWithMeItem,
  type ShareSummary,
} from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor, query } from '../db/query';
import { requireAuth } from '../middleware/auth';
import { getEnumerableFolderIds } from '../utils/folderEnumeration';
import { buildPublicWebUrl } from '../utils/publicWebUrl';
import {
  ensureCanAdminEntity,
  ensureFolderAccess,
  ensurePageAccess,
  lockEntityAccess,
  lockEntityAccessMutation,
  parseEntityType,
  parsePermission,
  parsePublicPermission,
  type ShareEntityType,
  type SharePermission,
} from '../utils/share-access';
import {
  notifyShareGrant,
  notifyShareRecompute,
  notifyShareRevoke,
  notifyShareUpdate,
} from '../utils/share-notify';
import { getAccessors, getAccessSources, toCollaboratorDisplays } from '../utils/shareAccessors';
import { getEntityMetaUserIds, mergeMetaUserIds } from '../utils/shareRecipients';

type PublicPermission = 'view' | 'edit';
type EntityInfo = {
  id: string;
  ownerId: string | null;
  title: string;
  inheritancePolicy: 'inherit' | 'restricted';
  publicPermission: PublicPermission | null;
};

type GrantRow = {
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
};

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

const buildPagePath = (title: string, pageId: string) =>
  buildPublicWebUrl(buildSharedPagePath(title, pageId));
const buildFolderPath = (title: string, folderId: string) =>
  buildPublicWebUrl(buildSharedFolderPath(title, folderId));
const buildEntityPath = (entity: EntityInfo, entityType: ShareEntityType) =>
  entityType === 'page'
    ? buildPagePath(entity.title, entity.id)
    : buildFolderPath(entity.title, entity.id);

const timestampValue = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

async function resolveEntity(
  entityType: ShareEntityType,
  entityId: string,
  executor: QueryExecutor = db,
): Promise<EntityInfo> {
  const result =
    entityType === 'page'
      ? await executeQuery<{
          id: string;
          owner_id: string | null;
          title: string;
          inheritance_policy: 'inherit' | 'restricted';
          public_permission: PublicPermission | null;
        }>(
          executor,
          sql`select page.id,
                  coalesce(get_root_folder_owner(page.parent_id), page.created_by) as owner_id,
                  page.title, page.inheritance_policy, page.public_permission
           from pages page
           where page.id = ${entityId} and page.is_deleted = false`,
        )
      : await executeQuery<{
          id: string;
          owner_id: string | null;
          title: string;
          inheritance_policy: 'inherit' | 'restricted';
          public_permission: PublicPermission | null;
        }>(
          executor,
          sql`select folder.id, get_root_folder_owner(folder.id) as owner_id,
                  folder.name as title, folder.inheritance_policy, folder.public_permission
           from folders folder
           where folder.id = ${entityId} and folder.is_deleted = false`,
        );
  const entity = result.rows[0];
  if (!entity) {
    throw new HTTPException(404, {
      message: entityType === 'page' ? 'Page not found' : 'Folder not found',
    });
  }
  return {
    id: entity.id,
    ownerId: entity.owner_id,
    title: entity.title,
    inheritancePolicy: entity.inheritance_policy,
    publicPermission: entity.public_permission,
  };
}

async function ensureEntityAccess(
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
  executor: QueryExecutor,
) {
  return entityType === 'page'
    ? ensurePageAccess(entityId, userId, 'view', executor)
    : ensureFolderAccess(entityId, userId, 'view', executor);
}

function normalizeGrant(row: GrantRow): EntityShare {
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
  };
}

async function getDirectGrants(
  entityType: ShareEntityType,
  entityId: string,
  executor: QueryExecutor,
): Promise<EntityShare[]> {
  const result = await executeQuery<GrantRow>(
    executor,
    sql`select share.id, share.entity_type, share.entity_id, share.permission,
            share.recipient_user_id, recipient.email as recipient_email,
            recipient.name as recipient_name,
            coalesce(recipient.avatar_url, recipient.image) as recipient_avatar_url,
            sharer.name as shared_by_name, sharer.email as shared_by_email,
            share.created_at, share.updated_at
     from shares share
     join users recipient on recipient.id = share.recipient_user_id
     left join users sharer on sharer.id = share.shared_by
     where share.entity_type = ${entityType} and share.entity_id = ${entityId}
     order by lower(coalesce(recipient.name, recipient.email)), share.created_at`,
  );
  return result.rows.map(normalizeGrant);
}

async function getInheritedPublicAccess(
  entityType: ShareEntityType,
  entityId: string,
  executor: QueryExecutor,
): Promise<InheritedPublicAccess[]> {
  const result =
    entityType === 'page'
      ? await executeQuery<{
          entity_id: string;
          entity_title: string;
          permission: PublicPermission;
        }>(
          executor,
          sql`select folder.id as entity_id, folder.name as entity_title,
                  folder.public_permission as permission
           from pages page
           join folder_closure path on path.descendant_id = page.parent_id
           join folders folder on folder.id = path.ancestor_id
           where page.id = ${entityId} and page.is_deleted = false
             and folder.is_deleted = false
             and folder.public_permission is not null
             and not is_page_folder_inheritance_blocked(folder.id, page.id)
           order by case folder.public_permission when 'edit' then 2 else 1 end desc,
                    path.depth asc`,
        )
      : await executeQuery<{
          entity_id: string;
          entity_title: string;
          permission: PublicPermission;
        }>(
          executor,
          sql`select folder.id as entity_id, folder.name as entity_title,
                  folder.public_permission as permission
           from folder_closure path
           join folders folder on folder.id = path.ancestor_id
           where path.descendant_id = ${entityId} and path.depth > 0
             and folder.is_deleted = false
             and folder.public_permission is not null
             and not is_folder_inheritance_blocked(folder.id, ${entityId})
           order by case folder.public_permission when 'edit' then 2 else 1 end desc,
                    path.depth asc`,
        );
  return result.rows.map((row) => ({
    entityId: row.entity_id,
    entityTitle: row.entity_title,
    permission: row.permission,
    url: buildFolderPath(row.entity_title, row.entity_id),
  }));
}

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
    ...normalizeGrant(row),
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
  return db.transaction(async (tx) => {
    await lockEntityAccess(tx, entityType, entityId);
    const entity = await resolveEntity(entityType, entityId, tx);
    const access = await ensureEntityAccess(entityType, entityId, user.id, tx);
    const hasManagementAccess = access.fullAccess || access.permission === 'admin';
    const publicAccess = {
      permission: entity.publicPermission ?? ('private' as const),
      url: buildEntityPath(entity, entityType),
    };

    if (!hasManagementAccess) {
      const sources = await getAccessSources(entityType, entityId, tx);
      const collaborators = toCollaboratorDisplays(getAccessors(sources));
      return c.json({
        visibility: 'limited',
        collaborators,
        entity: { type: entityType, id: entity.id, title: entity.title, ownerId: null },
        publicAccess,
        inheritance: { policy: 'inherit' },
        grants: [],
        accessors: [],
        accessSources: [],
        inheritedPublicAccess: [],
        userPermission: access.permission,
        capabilities: deriveCapabilities(access.permission, access.fullAccess),
        permissionDetails: [],
        inheritedAccessors: [],
      } satisfies ShareSummary);
    }

    const [grants, sources, inheritedPublicAccess] = await Promise.all([
      getDirectGrants(entityType, entityId, tx),
      getAccessSources(entityType, entityId, tx),
      getInheritedPublicAccess(entityType, entityId, tx),
    ]);
    const enumerableFolders = await getEnumerableFolderIds(user.id, tx);
    const visibleSources = sources.map((source) => {
      if (!source.folderId || enumerableFolders.has(source.folderId)) return source;
      const redacted = { ...source, grantId: null };
      delete redacted.folderId;
      delete redacted.folderName;
      return redacted;
    });
    const accessors = getAccessors(visibleSources);
    const userSources = visibleSources.filter((source) => source.userId === user.id);

    return c.json({
      visibility: 'full',
      collaborators: toCollaboratorDisplays(accessors),
      entity: {
        type: entityType,
        id: entity.id,
        title: entity.title,
        ownerId: entity.ownerId,
      },
      publicAccess,
      inheritance: { policy: entity.inheritancePolicy },
      grants,
      accessors,
      accessSources: visibleSources,
      inheritedPublicAccess: inheritedPublicAccess.filter((item) =>
        enumerableFolders.has(item.entityId),
      ),
      userPermission: access.permission,
      capabilities: deriveCapabilities(access.permission, access.fullAccess),
      permissionDetails: userSources.map((source) => ({
        source:
          source.kind === 'direct'
            ? ('grant' as const)
            : source.kind === 'owner'
              ? ('owner' as const)
              : source.kind,
        permission: source.permission,
        ...(source.folderId ? { folderId: source.folderId, folderName: source.folderName } : {}),
      })),
      inheritedAccessors: visibleSources
        .filter(
          (source): source is EntityAccessSource & { kind: 'folder' | 'workspace' } =>
            source.kind === 'folder' || source.kind === 'workspace',
        )
        .map((source) => ({
          userId: source.userId,
          name: source.name,
          email: source.email,
          permission: source.permission,
          source: source.kind,
          ...(source.folderId ? { folderId: source.folderId, folderName: source.folderName } : {}),
        })),
    } satisfies ShareSummary);
  });
});

sharesRoute.patch('/entity/:entityType/:entityId/inheritance', async (c) => {
  const entityType = parseEntityType(c.req.param('entityType'));
  const entityId = c.req.param('entityId');
  const user = c.get('user') as { id: string };
  const body = await c.req.json().catch(() => null);
  const policy = body && typeof body === 'object' ? (body as { policy?: unknown }).policy : null;
  if (policy !== 'inherit' && policy !== 'restricted') {
    throw new HTTPException(400, { message: 'Invalid inheritance policy' });
  }

  const entity = await resolveEntity(entityType, entityId);
  await ensureCanAdminEntity(entityType, entityId, user.id);
  await db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, entityType, entityId);
    await ensureCanAdminEntity(entityType, entityId, user.id, tx);
    const affectedBefore = await getEntityMetaUserIds(tx, entityType, entityId);
    await executeQuery(
      tx,
      entityType === 'page'
        ? sql`update pages set inheritance_policy = ${policy}, updated_at = now() where id = ${entityId}`
        : sql`update folders set inheritance_policy = ${policy}, updated_at = now() where id = ${entityId}`,
    );
    const affectedAfter = await getEntityMetaUserIds(tx, entityType, entityId);
    await notifyShareRecompute(
      {
        entityType,
        entityId,
        metaUserIds: mergeMetaUserIds(affectedBefore, affectedAfter),
        message:
          policy === 'restricted'
            ? `${entity.title} stopped inheriting access`
            : `${entity.title} now inherits access`,
      },
      tx,
    );
  });
  return c.json({
    policy,
    message:
      policy === 'restricted'
        ? `${entity.title} stopped inheriting access`
        : `${entity.title} now inherits access`,
  });
});

sharesRoute.patch('/entity/:entityType/:entityId/public-access', async (c) => {
  const entityType = parseEntityType(c.req.param('entityType'));
  const entityId = c.req.param('entityId');
  const user = c.get('user') as { id: string };
  const body = await c.req.json().catch(() => null);
  const requestedPermission =
    body && typeof body === 'object' ? (body as { permission?: unknown }).permission : null;
  const entity = await resolveEntity(entityType, entityId);
  await ensureCanAdminEntity(entityType, entityId, user.id);

  const nextPermission =
    requestedPermission === 'private' ? null : parsePublicPermission(requestedPermission);
  await db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, entityType, entityId);
    await ensureCanAdminEntity(entityType, entityId, user.id, tx);
    const affectedBefore = await getEntityMetaUserIds(tx, entityType, entityId);
    await executeQuery(
      tx,
      entityType === 'page'
        ? sql`update pages set public_permission = ${nextPermission}, updated_at = now() where id = ${entityId}`
        : sql`update folders set public_permission = ${nextPermission}, updated_at = now() where id = ${entityId}`,
    );

    if (nextPermission === null) {
      if (entityType === 'page') {
        await executeQuery(
          tx,
          sql`delete from page_public_access_visits visit
           where visit.page_id = ${entityId} and get_public_page_permission(visit.page_id) is null`,
        );
      } else {
        await executeQuery(
          tx,
          sql`delete from folder_public_access_visits visit
           where visit.folder_id in (
             select descendant_id from folder_closure where ancestor_id = ${entityId}
           )`,
        );
        await executeQuery(
          tx,
          sql`delete from page_public_access_visits visit
           using pages page, folder_closure path
           where visit.page_id = page.id
             and path.ancestor_id = ${entityId} and path.descendant_id = page.parent_id`,
        );
      }
    }

    const affectedAfter = await getEntityMetaUserIds(tx, entityType, entityId);
    const notification = {
      entityType,
      entityId,
      metaUserIds: mergeMetaUserIds(affectedBefore, affectedAfter),
      message:
        nextPermission === null
          ? `Public access removed for ${entity.title}`
          : nextPermission === 'view'
            ? `${entity.title} is now public view only`
            : `${entity.title} is now publicly editable`,
    };
    if (nextPermission === null) {
      await notifyShareRevoke(notification, tx);
    } else {
      await notifyShareUpdate({ ...notification, permission: nextPermission }, tx);
    }
  });

  return c.json({
    permission: nextPermission ?? 'private',
    url: buildEntityPath(entity, entityType),
    message:
      nextPermission === null
        ? `Public access removed for ${entity.title}`
        : nextPermission === 'view'
          ? `${entity.title} is now public view only`
          : `${entity.title} is now publicly editable`,
  });
});

sharesRoute.post('/entity/:entityType/:entityId/grants', async (c) => {
  const entityType = parseEntityType(c.req.param('entityType'));
  const entityId = c.req.param('entityId');
  const user = c.get('user') as { id: string };
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }
  const { email, permission } = body as { email?: unknown; permission?: unknown };
  if (typeof email !== 'string' || email.trim().length === 0) {
    throw new HTTPException(400, { message: 'Email is required' });
  }
  const nextPermission = parsePermission(permission);
  const entity = await resolveEntity(entityType, entityId);
  await ensureCanAdminEntity(entityType, entityId, user.id);

  const recipientResult = await query<{ id: string; email: string }>(
    sql`select id, email from users where lower(email) = lower(${email.trim()}) limit 1`,
  );
  const recipient = recipientResult.rows[0];
  if (!recipient) throw new HTTPException(404, { message: 'User not found' });
  if (recipient.id === user.id) {
    throw new HTTPException(400, { message: 'Cannot share with yourself' });
  }
  if (recipient.id === entity.ownerId) {
    throw new HTTPException(400, { message: 'Owner already has full access' });
  }

  const sharer = await query<{ name: string | null }>(
    sql`select name from users where id = ${user.id}`,
  );
  const sharedByName = sharer.rows[0]?.name ?? 'Someone';
  let created = false;
  await db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, entityType, entityId);
    const actorAccess = await ensureCanAdminEntity(entityType, entityId, user.id, tx);
    if (nextPermission === 'admin' && !actorAccess.fullAccess) {
      throw new HTTPException(403, { message: 'Only the owner can grant admin access' });
    }
    const existing = await executeQuery<{ id: string; permission: SharePermission }>(
      tx,
      sql`select id, permission from shares
       where entity_type = ${entityType} and entity_id = ${entityId} and recipient_user_id = ${recipient.id}
       for update`,
    );
    const current = existing.rows[0];
    if (current?.permission === 'admin' && !actorAccess.fullAccess) {
      throw new HTTPException(403, { message: 'Only the owner can change an admin' });
    }
    if (current) {
      await executeQuery(
        tx,
        sql`update shares set permission = ${nextPermission}, shared_by = ${user.id}, updated_at = now() where id = ${current.id}`,
      );
    } else {
      created = true;
      await executeQuery(
        tx,
        sql`insert into shares
           (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values (${entityType}, ${entityId}, ${user.id}, ${recipient.id}, ${nextPermission})`,
      );
    }
    const notification = {
      entityType,
      entityId,
      permission: nextPermission,
      targetUserId: recipient.id,
      entityTitle: entity.title,
      sharedByName,
    };
    if (created) await notifyShareGrant(notification, tx);
    else await notifyShareUpdate(notification, tx);
  });

  return c.json({
    ok: true,
    message: created
      ? `Granted ${nextPermission} access to ${recipient.email} on ${entity.title}`
      : `Updated ${recipient.email}'s access to ${nextPermission} on ${entity.title}`,
  });
});

sharesRoute.patch('/grants/:grantId', async (c) => {
  const grantId = c.req.param('grantId');
  const user = c.get('user') as { id: string };
  const body = await c.req.json().catch(() => null);
  const nextPermission = parsePermission(
    body && typeof body === 'object' ? (body as { permission?: unknown }).permission : null,
  );
  const grantResult = await query<{
    entity_type: ShareEntityType;
    entity_id: string;
  }>(sql`select entity_type, entity_id from shares where id = ${grantId}`);
  const grant = grantResult.rows[0];
  if (!grant) throw new HTTPException(404, { message: 'Grant not found' });
  const entity = await resolveEntity(grant.entity_type, grant.entity_id);
  await ensureCanAdminEntity(grant.entity_type, grant.entity_id, user.id);

  const responseMessage = await db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, grant.entity_type, grant.entity_id);
    const actorAccess = await ensureCanAdminEntity(grant.entity_type, grant.entity_id, user.id, tx);
    const target = await executeQuery<{
      permission: SharePermission;
      recipient_user_id: string;
      recipient_email: string;
    }>(
      tx,
      sql`select share.permission, share.recipient_user_id, recipient.email as recipient_email
       from shares share
       join users recipient on recipient.id = share.recipient_user_id
       where share.id = ${grantId}
       for update of share`,
    );
    const current = target.rows[0];
    if (!current) throw new HTTPException(404, { message: 'Grant not found' });
    if ((current.permission === 'admin' || nextPermission === 'admin') && !actorAccess.fullAccess) {
      throw new HTTPException(403, {
        message: 'Only the owner can grant or change admin access',
      });
    }
    await executeQuery(
      tx,
      sql`update shares set permission = ${nextPermission}, updated_at = now() where id = ${grantId}`,
    );
    await notifyShareUpdate(
      {
        entityType: grant.entity_type,
        entityId: grant.entity_id,
        permission: nextPermission,
        targetUserId: current.recipient_user_id,
      },
      tx,
    );
    return `Updated ${current.recipient_email}’s access to ${nextPermission} on ${entity.title}`;
  });
  return c.json({ ok: true, message: responseMessage });
});

sharesRoute.delete('/grants/:grantId', async (c) => {
  const grantId = c.req.param('grantId');
  const user = c.get('user') as { id: string };
  const grantResult = await query<{
    entity_type: ShareEntityType;
    entity_id: string;
    recipient_user_id: string;
    permission: SharePermission;
  }>(
    sql`select entity_type, entity_id, recipient_user_id, permission from shares where id = ${grantId}`,
  );
  const grant = grantResult.rows[0];
  if (!grant) throw new HTTPException(404, { message: 'Grant not found' });
  const selfRemoval = grant.recipient_user_id === user.id;
  if (!selfRemoval) await ensureCanAdminEntity(grant.entity_type, grant.entity_id, user.id);
  const entity = await resolveEntity(grant.entity_type, grant.entity_id);

  const responseMessage = await db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, grant.entity_type, grant.entity_id);
    const actorAccess = selfRemoval
      ? null
      : await ensureCanAdminEntity(grant.entity_type, grant.entity_id, user.id, tx);
    const target = await executeQuery<{
      recipient_user_id: string;
      permission: SharePermission;
      recipient_email: string;
    }>(
      tx,
      sql`select share.recipient_user_id, share.permission, recipient.email as recipient_email
       from shares share
       join users recipient on recipient.id = share.recipient_user_id
       where share.id = ${grantId}
       for update of share`,
    );
    const current = target.rows[0];
    if (!current) throw new HTTPException(404, { message: 'Grant not found' });
    if (!selfRemoval && current.permission === 'admin' && !actorAccess?.fullAccess) {
      throw new HTTPException(403, { message: 'Only the owner can remove an admin' });
    }
    await executeQuery(tx, sql`delete from shares where id = ${grantId}`);
    await notifyShareRevoke(
      {
        entityType: grant.entity_type,
        entityId: grant.entity_id,
        targetUserId: current.recipient_user_id,
        ...(selfRemoval && entity.ownerId ? { metaUserIds: [entity.ownerId] } : {}),
      },
      tx,
    );
    return selfRemoval
      ? `Removed ${entity.title} from your view`
      : `Removed ${current.recipient_email}’s access to ${entity.title}`;
  });
  return c.json({ ok: true, message: responseMessage });
});

export default sharesRoute;
