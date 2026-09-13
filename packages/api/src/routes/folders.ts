import {
  type AccountFolderPayload,
  deriveCapabilities,
  type PublicFolderPayload,
} from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { auth } from '../auth';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor, query } from '../db/query';
import { requireAuth } from '../middleware/auth';
import { deletedFolderOwnerSql } from '../utils/deletedEntityOwner';
import { moveFolderToTrash, removeFolderFromView } from '../utils/entityRemoval';
import { getEnumerableFolderIds, redactParentId } from '../utils/folderEnumeration';
import {
  copyFolderForActor,
  createFolderForActor,
  getFolderForUser,
  listTrashedFoldersForUser,
  permanentlyDeleteFolder,
  restoreFolderForUser,
  updateFolderForUser,
} from '../utils/folderLifecycle';
import {
  type FolderDatabaseRowWithOwner,
  type NormalizedFolderRow,
  normalizeFolderRow,
} from '../utils/folderRows';
import { getRequestActor } from '../utils/guestAccess';
import {
  getPublicPermission,
  type PublicPermission,
  recordPublicVisitAndNotify,
  resolveEntityAccess,
} from '../utils/publicAccess';
import {
  ensureFolderAccess,
  lockEntityAccess,
  lockWorkspaceAccessMutation,
  type SharePermission,
} from '../utils/share-access';
import { purgeFolderSubtrees } from '../utils/trashLifecycle';
import { drainUploadDeletionQueueBestEffort } from '../utils/uploadCleanup';

const foldersRoute = new Hono();
const foldersPublicRoute = new Hono();
const bodyLimitError = (c: Context) => c.json({ message: 'Request body is too large' }, 413);

foldersRoute.use('*', requireAuth);
foldersRoute.use('*', bodyLimit({ maxSize: 16 * 1024, onError: bodyLimitError }));
const publicFolderBodyLimit = bodyLimit({ maxSize: 4 * 1024, onError: bodyLimitError });

const toFolderDto = (folder: NormalizedFolderRow, parentId: string | null) => ({
  id: folder.id,
  parentId,
  name: folder.name,
  icon: folder.icon,
  position: folder.position,
  createdBy: folder.createdBy,
  ownerId: folder.ownerId ?? null,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
  publicPermission: folder.publicPermission,
  inheritancePolicy: folder.inheritancePolicy,
});

/** Raw SQL result timestamps may be strings while Drizzle rows are Dates. */
export function serializeTimestamp(value: Date | string): string;
export function serializeTimestamp(value: null | undefined): null;
export function serializeTimestamp(value: Date | string | null | undefined): string | null;
export function serializeTimestamp(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

const toPublicFolderDto = (
  folder: NormalizedFolderRow,
  publicPermission: PublicPermission,
  userPermission: PublicPermission,
  pages: PublicFolderPayload['pages'],
  childFolders: PublicFolderPayload['folders'],
): PublicFolderPayload => ({
  accessScope: 'public',
  id: folder.id,
  name: folder.name,
  icon: folder.icon,
  updatedAt: serializeTimestamp(folder.updatedAt),
  publicPermission,
  userPermission,
  capabilities: deriveCapabilities(userPermission),
  pages,
  folders: childFolders,
});

const getFolderById = async (folderId: string, executor?: QueryExecutor) => {
  const statement = sql`select f.*, get_root_folder_owner(f.id) as owner_id from folders f where f.id = ${folderId} and f.is_deleted = false limit 1`;
  const result = executor
    ? await executeQuery<FolderDatabaseRowWithOwner>(executor, statement)
    : await query<FolderDatabaseRowWithOwner>(statement);
  const row = result.rows[0] ?? null;
  return row ? normalizeFolderRow(row, row.owner_id) : null;
};

const buildFolderTree = <T extends { id: string; parentId: string | null }>(rows: T[]) => {
  type FolderNode = T & { children: FolderNode[] };
  const nodes: FolderNode[] = rows.map((folder) => ({
    ...folder,
    children: [],
  }));
  const map = new Map<string, (typeof nodes)[number]>();
  for (const node of nodes) {
    map.set(node.id, node);
  }

  const roots: typeof nodes = [];
  for (const node of nodes) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
};

foldersRoute.get('/tree', async (c) => {
  const user = c.get('user') as { id: string };

  type FolderTreeDatabaseRow = FolderDatabaseRowWithOwner & {
    enumerable_parent_id: string | null;
    user_permission: string | null;
    workspace_access: boolean;
  };
  const result = await query<FolderTreeDatabaseRow>(
    sql`
      select f.*, get_root_folder_owner(f.id) as owner_id,
             case
               when f.parent_id in (select folder_id from get_enumerable_folder_ids(${user.id}))
                 then f.parent_id
               else null
             end as enumerable_parent_id,
             access.permission as user_permission,
             exists (
               select 1 from workspace_members wm
               where wm.workspace_owner_id = get_root_folder_owner(f.id)
                 and wm.member_id = ${user.id}
                 and not is_folder_path_restricted(f.id)
             ) as workspace_access
      from folders f
      join lateral get_effective_folder_permission(f.id, ${user.id}) access on true
      where f.is_deleted = false
        and f.id in (select folder_id from get_enumerable_folder_ids(${user.id}))
        and access.permission is not null
      order by f.parent_id nulls first, case when f.parent_id is null then f.updated_at end desc nulls last, f.position::numeric asc
    `,
  );

  return c.json(
    buildFolderTree(
      result.rows.map((row) => {
        const folder = normalizeFolderRow(row, row.owner_id);
        return {
          ...toFolderDto(folder, row.enumerable_parent_id ?? null),
          userPermission: row.user_permission ?? null,
          workspaceAccess: row.workspace_access === true,
        };
      }),
    ),
  );
});

foldersPublicRoute.post('/', publicFolderBodyLimit, async (c) => {
  const body = await c.req.json().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'BodyLimitError') throw error;
    return null;
  });
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }

  const { parentId, name, icon } = body as {
    parentId?: string | null;
    name?: string;
    icon?: string | null;
  };

  const actor = await getRequestActor(c);
  if (!parentId && actor.kind === 'guest') {
    throw new HTTPException(401, { message: 'Log in to create a root folder' });
  }

  const created = await createFolderForActor(actor, {
    parentId: parentId ?? null,
    ...(typeof name === 'string' ? { name } : {}),
    ...(icon === null || typeof icon === 'string' ? { icon } : {}),
  });
  return c.json(created.folder, 201);
});

foldersRoute.get('/trash', async (c) => {
  const user = c.get('user') as { id: string };
  return c.json(await listTrashedFoldersForUser(user.id));
});

foldersRoute.delete('/trash/empty-all', async (c) => {
  const user = c.get('user') as { id: string };
  const purged = await db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, user.id);
    const roots = await executeQuery<{ id: string }>(
      tx,
      sql`select f.id
       from folders f
       left join folders parent on parent.id = f.parent_id
       where f.is_deleted = true
         and ${deletedFolderOwnerSql} = ${user.id}
         and coalesce(parent.is_deleted, false) = false
       order by f.id
       for update of f`,
    );
    return purgeFolderSubtrees(
      tx,
      roots.rows.map((row) => row.id),
    );
  });
  await drainUploadDeletionQueueBestEffort();

  return c.json({ deleted: true, folders: purged.folders, pages: purged.pages });
});

foldersRoute.patch(':id/restore', async (c) => {
  const folderId = c.req.param('id');
  const user = c.get('user') as { id: string };
  return c.json(await restoreFolderForUser(folderId, user.id));
});

foldersRoute.delete(':id/permanent', async (c) => {
  const folderId = c.req.param('id');
  const user = c.get('user') as { id: string };
  const result = await permanentlyDeleteFolder(folderId, user.id);
  return c.json({ deleted: true, folders: result.folders, pages: result.pages });
});

foldersRoute.get(':id', async (c) => {
  const folderId = c.req.param('id');
  const user = c.get('user') as { id: string };
  const result = await getFolderForUser(folderId, user.id);
  return c.json(toFolderDto(result.folder, result.folder.parentId));
});

foldersRoute.patch(':id', async (c) => {
  const folderId = c.req.param('id');
  const user = c.get('user') as { id: string };
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'BodyLimitError') throw error;
    throw new HTTPException(400, { message: 'Invalid JSON body', cause: error });
  }
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }
  const { name, icon, parentId, position } = body as {
    name?: string;
    icon?: string | null;
    parentId?: string | null;
    position?: string | number;
  };
  const updated = await updateFolderForUser(folderId, user.id, {
    ...(typeof name === 'string' ? { name } : {}),
    ...(Object.hasOwn(body, 'icon') ? { icon: icon ?? null } : {}),
    ...(Object.hasOwn(body, 'parentId') ? { parentId: parentId ?? null } : {}),
    ...(position === undefined ? {} : { position }),
  });
  return c.json(toFolderDto(updated, updated.parentId));
});

foldersPublicRoute.post(':id/copy', publicFolderBodyLimit, async (c) => {
  const folderId = c.req.param('id');
  const actor = await getRequestActor(c);
  const body = await c.req.json().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'BodyLimitError') throw error;
    return null;
  });
  const parentId =
    body && typeof body === 'object'
      ? ((body as { parentId?: string | null }).parentId ?? null)
      : null;
  const copyResult = await copyFolderForActor(actor, folderId, parentId);
  const newFolder = copyResult.folder;
  if (!newFolder) {
    throw new HTTPException(409, {
      message: 'Source folder is no longer accessible',
      cause: { code: 'SOURCE_FOLDER_UNAVAILABLE' },
    });
  }
  return c.json({ ...newFolder, skippedRestrictedItems: copyResult.skippedRestrictedItems }, 201);
});

foldersRoute.delete(':id', async (c) => {
  const folderId = c.req.param('id');
  const user = c.get('user') as { id: string };
  const force = c.req.query('force') === 'true';
  const deletionResult = await moveFolderToTrash(folderId, user.id, force);

  if ('requiresForce' in deletionResult) {
    return c.json(
      {
        code: 'FOLDER_NOT_EMPTY',
        ...deletionResult,
        message: 'Folder is not empty. Confirm recursive deletion to continue.',
      },
      409,
    );
  }

  return c.json(deletionResult);
});

foldersRoute.post(':id/leave', async (c) => {
  const folderId = c.req.param('id');
  const user = c.get('user') as { id: string };
  await removeFolderFromView(folderId, user.id);
  return c.json({ ok: true });
});

foldersPublicRoute.get(
  ':id{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}}',
  async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    const folderId = c.req.param('id');
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const sessionUserId = session?.user ? (session.user as { id: string }).id : null;
    const result = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'folder', folderId);
      const lockedFolder = await getFolderById(folderId, tx);
      if (!lockedFolder) {
        throw new HTTPException(404, { message: 'Folder not found' });
      }

      const resolvedAccess = sessionUserId
        ? await resolveEntityAccess('folder', folderId, sessionUserId, tx)
        : null;
      const publicPermission = resolvedAccess
        ? resolvedAccess.publicPermission
        : await getPublicPermission('folder', folderId, tx);
      const hasAccountAccess = Boolean(resolvedAccess?.accountPermission);
      let userPermission: SharePermission;
      let fullAccess = false;
      if (resolvedAccess) {
        if (!resolvedAccess.permission) {
          throw new HTTPException(403, { message: "You don't have access to this folder" });
        }
        userPermission = resolvedAccess.permission;
        fullAccess = resolvedAccess.fullAccess;
      } else {
        if (!publicPermission) {
          throw new HTTPException(401, { message: 'Log in to access this folder' });
        }
        userPermission = publicPermission;
      }

      if (sessionUserId && publicPermission && lockedFolder.ownerId !== sessionUserId) {
        await recordPublicVisitAndNotify(tx, 'folder', folderId, sessionUserId);
      }

      type PublicFolderPageRow = {
        id: string;
        parent_id: string | null;
        title: string;
        icon: string | null;
        created_by: string | null;
        owner_id: string | null;
        created_at: Date | string;
        updated_at: Date | string;
        public_permission: PublicPermission | null;
        user_permission: SharePermission;
      };
      type PublicFolderChildRow = {
        id: string;
        parent_id: string | null;
        name: string;
        icon: string | null;
        created_by: string | null;
        owner_id: string | null;
        created_at: Date | string;
        updated_at: Date | string;
        public_permission: PublicPermission | null;
        user_permission: SharePermission;
      };
      const pagesResult = await executeQuery<PublicFolderPageRow>(
        tx,
        sql`SELECT id, title, icon, created_by, created_at, updated_at, parent_id,
                get_public_page_permission(p.id) as public_permission,
                coalesce(get_root_folder_owner(p.parent_id), p.created_by) as owner_id,
                access.permission as user_permission
         FROM pages p
         JOIN LATERAL get_effective_page_permission(p.id, ${sessionUserId}::uuid) access ON true
         WHERE parent_id = ${folderId} AND is_deleted = false
           AND access.permission IS NOT NULL
         ORDER BY position::numeric ASC`,
      );
      const foldersResult = await executeQuery<PublicFolderChildRow>(
        tx,
        sql`SELECT id, parent_id, name, icon, created_by, created_at, updated_at,
                get_public_folder_permission(f.id) as public_permission,
                get_root_folder_owner(f.id) as owner_id,
                access.permission as user_permission
         FROM folders f
         JOIN LATERAL get_effective_folder_permission(f.id, ${sessionUserId}::uuid) access ON true
         WHERE parent_id = ${folderId} AND is_deleted = false
           AND access.permission IS NOT NULL
         ORDER BY position::numeric ASC`,
      );

      const enumerableFolderIds =
        sessionUserId && hasAccountAccess
          ? await getEnumerableFolderIds(sessionUserId, tx)
          : new Set<string>();

      const pages = pagesResult.rows.map((page) => {
        return {
          accessScope: 'account' as const,
          id: page.id,
          parentId: page.parent_id,
          title: page.title,
          icon: page.icon,
          createdBy: page.created_by,
          ownerId: page.owner_id,
          createdAt: serializeTimestamp(page.created_at),
          updatedAt: serializeTimestamp(page.updated_at),
          publicPermission: page.public_permission,
          userPermission: page.user_permission,
        } satisfies AccountFolderPayload['pages'][number];
      });
      const childFolders = foldersResult.rows.map((folder) => {
        return {
          accessScope: 'account' as const,
          id: folder.id,
          parentId: folder.parent_id,
          name: folder.name,
          icon: folder.icon,
          createdBy: folder.created_by,
          ownerId: folder.owner_id,
          createdAt: serializeTimestamp(folder.created_at),
          updatedAt: serializeTimestamp(folder.updated_at),
          publicPermission: folder.public_permission,
          userPermission: folder.user_permission,
        } satisfies AccountFolderPayload['folders'][number];
      });

      if (!hasAccountAccess) {
        if (!publicPermission) {
          throw new HTTPException(403, { message: 'You do not have public access to this folder' });
        }
        const publicPages = pages.flatMap((page) =>
          page.publicPermission
            ? [
                {
                  accessScope: 'public',
                  id: page.id,
                  title: page.title,
                  icon: page.icon,
                  updatedAt: serializeTimestamp(page.updatedAt),
                  publicPermission: page.publicPermission,
                  userPermission: page.publicPermission,
                } satisfies PublicFolderPayload['pages'][number],
              ]
            : [],
        );
        const publicChildFolders = childFolders.flatMap((folder) =>
          folder.publicPermission
            ? [
                {
                  accessScope: 'public',
                  id: folder.id,
                  name: folder.name,
                  icon: folder.icon,
                  updatedAt: serializeTimestamp(folder.updatedAt),
                  publicPermission: folder.publicPermission,
                  userPermission: folder.publicPermission,
                } satisfies PublicFolderPayload['folders'][number],
              ]
            : [],
        );
        return toPublicFolderDto(
          lockedFolder,
          publicPermission,
          publicPermission,
          publicPages,
          publicChildFolders,
        );
      }

      return {
        accessScope: 'account' as const,
        ...toFolderDto(lockedFolder, redactParentId(lockedFolder.parentId, enumerableFolderIds)),
        createdAt: serializeTimestamp(lockedFolder.createdAt),
        updatedAt: serializeTimestamp(lockedFolder.updatedAt),
        publicPermission,
        userPermission,
        capabilities: deriveCapabilities(userPermission, fullAccess),
        pages,
        folders: childFolders,
      } satisfies AccountFolderPayload;
    });

    return c.json(result);
  },
);

foldersPublicRoute.post(':id/access', publicFolderBodyLimit, async (c) => {
  const folderId = c.req.param('id');
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const sessionUserId = session?.user ? (session.user as { id: string }).id : null;
  await db.transaction(async (tx) => {
    await lockEntityAccess(tx, 'folder', folderId);
    const folder = await getFolderById(folderId, tx);
    if (!folder) throw new HTTPException(404, { message: 'Folder not found' });
    const publicPermission = await getPublicPermission('folder', folderId, tx);
    if (sessionUserId) {
      await ensureFolderAccess(folderId, sessionUserId, 'view', tx);
      if (publicPermission && folder.ownerId !== sessionUserId) {
        await recordPublicVisitAndNotify(tx, 'folder', folderId, sessionUserId);
      }
    } else if (!publicPermission) {
      throw new HTTPException(401, { message: 'Log in to access this folder' });
    }
  });

  return c.json({ ok: true });
});

export { foldersPublicRoute };
export default foldersRoute;
