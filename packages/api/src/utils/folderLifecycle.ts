import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor, query } from '../db/query';
import { deletedFolderOwnerSql } from './deletedEntityOwner';
import { getDestinationOwnerId } from './destinationOwner';
import { copyFolderRecursive, type FolderCopyResult } from './folderCopy';
import { getEnumerableFolderIds, redactParentId } from './folderEnumeration';
import { normalizeFolderName } from './folderName';
import {
  type FolderDatabaseRow,
  type FolderDatabaseRowWithOwner,
  type NormalizedFolderRow,
  normalizeFolderRow,
} from './folderRows';
import {
  ensureActorCanCreateInFolder,
  ensureActorFolderAccess,
  persistGuestIdentity,
  type RequestActor,
} from './guestAccess';
import { getNextPosition, normalizePosition } from './position';
import {
  ensureFolderAccess,
  ensureWorkspaceAdmin,
  lockEntityAccess,
  lockEntityAccessMutation,
  lockEntityAccessMutations,
  lockWorkspaceAccessMutation,
} from './share-access';
import { notifyShareRecompute } from './share-notify';
import { getEntityMetaUserIds, mergeMetaUserIds } from './shareRecipients';
import { purgeFolderSubtrees } from './trashLifecycle';

async function getActiveFolder(folderId: string, executor: QueryExecutor) {
  const result = await executeQuery<FolderDatabaseRowWithOwner>(
    executor,
    sql`select f.*, get_root_folder_owner(f.id) as owner_id
        from folders f where f.id = ${folderId} and f.is_deleted = false limit 1`,
  );
  const row = result.rows[0];
  return row ? normalizeFolderRow(row, row.owner_id) : null;
}

export async function copyFolderForActor(
  actor: RequestActor,
  folderId: string,
  parentId: string | null,
): Promise<FolderCopyResult> {
  if (!parentId && actor.kind === 'guest') {
    throw new HTTPException(401, { message: 'Log in to copy a folder to the workspace root' });
  }
  if (parentId === folderId) {
    throw new HTTPException(400, { message: 'Cannot set parent to self' });
  }

  return db.transaction(async (tx) => {
    await lockEntityAccessMutations(
      tx,
      [
        { entityType: 'folder', entityId: folderId },
        ...(parentId ? [{ entityType: 'folder' as const, entityId: parentId }] : []),
      ],
      parentId ? [] : [actor.id],
    );
    const sourceResult = await executeQuery<FolderDatabaseRowWithOwner>(
      tx,
      sql`select f.*, get_root_folder_owner(f.id) as owner_id
          from folders f where f.id = ${folderId} and f.is_deleted = false limit 1`,
    );
    const sourceRow = sourceResult.rows[0];
    if (!sourceRow) throw new HTTPException(404, { message: 'Folder not found' });
    const sourceFolder = normalizeFolderRow(sourceRow, sourceRow.owner_id);
    await ensureActorFolderAccess(actor, folderId, 'view', tx);
    if (parentId) await ensureActorCanCreateInFolder(actor, parentId, tx);
    if (parentId) {
      const cycle = await executeQuery(
        tx,
        sql`select 1 from folder_closure
            where ancestor_id = ${folderId} and descendant_id = ${parentId} and depth > 0`,
      );
      if ((cycle.rowCount ?? 0) > 0) {
        throw new HTTPException(400, { message: 'Cannot move folder into its own subtree' });
      }
    }
    await persistGuestIdentity(actor, tx);
    const destinationOwnerId = await getDestinationOwnerId(
      tx,
      parentId,
      actor.kind === 'user' ? actor.id : null,
    );
    if (!destinationOwnerId) {
      throw new HTTPException(404, { message: 'Destination workspace not found' });
    }
    const result = await copyFolderRecursive(
      tx,
      folderId,
      parentId,
      destinationOwnerId,
      actor,
      sourceFolder.ownerId === destinationOwnerId ? 'all' : 'non-page',
    );
    if (result.folder) {
      const metaUserIds = await getEntityMetaUserIds(tx, 'folder', result.folder.id);
      await notifyShareRecompute(
        { entityType: 'folder', entityId: result.folder.id, metaUserIds, metaOnly: true },
        tx,
      );
    }
    return result;
  });
}

export async function createFolderForActor(
  actor: RequestActor,
  request: { parentId: string | null; name?: string | undefined; icon?: string | null | undefined },
) {
  if (!request.parentId && actor.kind === 'guest') {
    throw new HTTPException(401, { message: 'Log in to create a root folder' });
  }
  return db.transaction(async (tx) => {
    if (request.parentId) {
      await lockEntityAccessMutation(tx, 'folder', request.parentId);
      await ensureActorCanCreateInFolder(actor, request.parentId, tx);
    } else {
      await lockWorkspaceAccessMutation(tx, actor.id);
    }
    await persistGuestIdentity(actor, tx);
    const ownerId = await getDestinationOwnerId(
      tx,
      request.parentId,
      actor.kind === 'user' ? actor.id : null,
    );
    if (!ownerId) throw new HTTPException(404, { message: 'Parent folder not found' });
    const position = await getNextPosition('folders', request.parentId, actor.id, tx);
    const icon =
      typeof request.icon === 'string' && request.icon.trim().length > 0
        ? request.icon.trim()
        : null;
    const result = await executeQuery<FolderDatabaseRow>(
      tx,
      sql`insert into folders (parent_id, name, icon, position, created_by)
          values (${request.parentId}, ${normalizeFolderName(request.name)}, ${icon}, ${position}, ${actor.kind === 'user' ? actor.id : null})
          returning *`,
    );
    const row = result.rows[0];
    if (!row) throw new HTTPException(500, { message: 'Failed to create folder' });
    const metaUserIds = await getEntityMetaUserIds(tx, 'folder', row.id);
    await notifyShareRecompute(
      { entityType: 'folder', entityId: row.id, metaUserIds, metaOnly: true },
      tx,
    );
    const permission =
      actor.kind === 'user'
        ? ((
            await executeQuery<{ permission: string | null }>(
              tx,
              sql`select permission from get_effective_folder_permission(${row.id}, ${actor.id})`,
            )
          ).rows[0]?.permission ?? null)
        : null;
    return { folder: normalizeFolderRow(row, ownerId), permission };
  });
}

export async function getFolderForUser(folderId: string, userId: string) {
  return db.transaction(async (tx) => {
    await lockEntityAccess(tx, 'folder', folderId);
    const folder = await getActiveFolder(folderId, tx);
    if (!folder) throw new HTTPException(404, { message: 'Folder not found' });
    await ensureFolderAccess(folderId, userId, 'view', tx);
    const enumerableFolderIds = await getEnumerableFolderIds(userId, tx);
    const permissionResult = await executeQuery<{ permission: string | null }>(
      tx,
      sql`select permission from get_effective_folder_permission(${folderId}, ${userId})`,
    );
    return {
      folder: { ...folder, parentId: redactParentId(folder.parentId, enumerableFolderIds) },
      permission: permissionResult.rows[0]?.permission ?? null,
    };
  });
}

async function ensureFolderMoveAccess(
  folder: NormalizedFolderRow,
  parentId: string | null,
  userId: string,
  executor: QueryExecutor,
): Promise<void> {
  if (!folder.ownerId) {
    throw new HTTPException(409, { message: 'Folder owner could not be determined' });
  }
  if (parentId === folder.id)
    throw new HTTPException(400, { message: 'Cannot set parent to self' });
  await ensureFolderAccess(folder.id, userId, 'admin', executor);
  if (folder.parentId) await ensureFolderAccess(folder.parentId, userId, 'admin', executor);
  else await ensureWorkspaceAdmin(folder.ownerId, userId, executor);

  let destinationOwnerId: string | null = folder.createdBy;
  if (parentId) {
    const destination = await getActiveFolder(parentId, executor);
    if (!destination?.ownerId) throw new HTTPException(404, { message: 'Parent folder not found' });
    destinationOwnerId = destination.ownerId;
    await ensureFolderAccess(parentId, userId, 'admin', executor);
    const cycle = await executeQuery(
      executor,
      sql`select 1 from folder_closure
          where ancestor_id = ${folder.id} and descendant_id = ${parentId} and depth > 0`,
    );
    if ((cycle.rowCount ?? 0) > 0) {
      throw new HTTPException(400, { message: 'Cannot move folder into its own subtree' });
    }
  } else if (destinationOwnerId) {
    await ensureWorkspaceAdmin(destinationOwnerId, userId, executor);
  }
  if (destinationOwnerId !== folder.ownerId) {
    throw new HTTPException(409, { message: 'Folders cannot be moved between different owners' });
  }
}

export async function updateFolderForUser(
  folderId: string,
  userId: string,
  request: {
    name?: string | undefined;
    icon?: string | null | undefined;
    parentId?: string | null | undefined;
    position?: string | number | undefined;
  },
) {
  return db.transaction(async (tx) => {
    const workspaceOwnerId = await lockEntityAccess(tx, 'folder', folderId);
    const folder = await getActiveFolder(folderId, tx);
    if (!folder) throw new HTTPException(404, { message: 'Folder not found' });
    const parentId = request.parentId === undefined ? folder.parentId : request.parentId;
    if (request.parentId === undefined && request.position === undefined) {
      await ensureFolderAccess(folderId, userId, 'admin', tx);
    } else {
      await ensureFolderMoveAccess(folder, parentId, userId, tx);
    }
    const accessChanged = parentId !== folder.parentId;
    if (accessChanged) await lockWorkspaceAccessMutation(tx, workspaceOwnerId);
    const affectedBefore = accessChanged ? await getEntityMetaUserIds(tx, 'folder', folderId) : [];
    const position =
      request.position !== undefined
        ? normalizePosition(request.position, folder.position)
        : request.parentId === undefined
          ? folder.position
          : await getNextPosition('folders', parentId, userId, tx);
    const name = request.name === undefined ? folder.name : normalizeFolderName(request.name);
    const icon =
      request.icon === undefined
        ? folder.icon
        : typeof request.icon === 'string' && request.icon.trim().length > 0
          ? request.icon.trim()
          : null;
    const result = await executeQuery<FolderDatabaseRow>(
      tx,
      sql`update folders set name = ${name}, icon = ${icon}, parent_id = ${parentId}, position = ${position}, updated_at = now()
          where id = ${folderId} and is_deleted = false returning *`,
    );
    const row = result.rows[0];
    if (!row) throw new HTTPException(404, { message: 'Folder not found' });
    if (accessChanged) {
      const affectedAfter = await getEntityMetaUserIds(tx, 'folder', folderId);
      await notifyShareRecompute(
        {
          entityType: 'folder',
          entityId: folderId,
          metaUserIds: mergeMetaUserIds(affectedBefore, affectedAfter),
        },
        tx,
      );
    }
    const enumerableFolderIds = await getEnumerableFolderIds(userId, tx);
    const normalized = normalizeFolderRow(row, folder.ownerId);
    return { ...normalized, parentId: redactParentId(normalized.parentId, enumerableFolderIds) };
  });
}

export async function listTrashedFoldersForUser(userId: string) {
  const result = await query<FolderDatabaseRowWithOwner>(
    sql`select f.*, ${deletedFolderOwnerSql} as owner_id
        from folders f
        left join folders parent on parent.id = f.parent_id
        where f.is_deleted = true
          and ${deletedFolderOwnerSql} = ${userId}
          and coalesce(parent.is_deleted, false) = false
        order by f.deleted_at desc nulls last, f.position::numeric asc`,
  );
  return result.rows.map((row) => normalizeFolderRow(row, row.owner_id));
}

export async function restoreFolderForUser(folderId: string, userId: string) {
  return db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, userId);
    const rootResult = await executeQuery<{
      parent_id: string | null;
      created_by: string | null;
      deleted_at: Date | null;
      deletion_batch_id: string | null;
      owner_id: string | null;
    }>(
      tx,
      sql`select f.parent_id, f.created_by, f.deleted_at, f.deletion_batch_id,
                 ${deletedFolderOwnerSql} as owner_id
          from folders f where f.id = ${folderId} and f.is_deleted = true for update`,
    );
    const root = rootResult.rows[0];
    if (!root) throw new HTTPException(404, { message: 'Folder not found' });
    if (root.owner_id !== userId) {
      throw new HTTPException(403, { message: 'You can only restore folders that you own' });
    }
    if (!root.deleted_at) {
      throw new HTTPException(409, { message: 'Folder deletion state is invalid' });
    }
    const affectedBefore = await getEntityMetaUserIds(tx, 'folder', folderId);
    const foldersResult = await executeQuery<{ id: string; depth: number }>(
      tx,
      sql`select f.id, fc.depth
          from folder_closure fc
          join folders f on f.id = fc.descendant_id
          where fc.ancestor_id = ${folderId} and f.is_deleted = true
            and (
              (${root.deletion_batch_id}::uuid is not null and f.deletion_batch_id = ${root.deletion_batch_id})
              or (${root.deletion_batch_id}::uuid is null and f.deletion_batch_id is null and f.deleted_at = ${root.deleted_at})
            )
          order by fc.depth, f.id for update of f`,
    );
    const folderIds = foldersResult.rows.map((row) => row.id);
    if (!folderIds.includes(folderId)) {
      throw new HTTPException(409, { message: 'Folder deletion state is invalid' });
    }
    const pagesResult = await executeQuery<{ id: string }>(
      tx,
      sql`select p.id from pages p
          where p.parent_id = any(${sql.param(folderIds)}::uuid[]) and p.is_deleted = true
            and (
              (${root.deletion_batch_id}::uuid is not null and p.deletion_batch_id = ${root.deletion_batch_id})
              or (${root.deletion_batch_id}::uuid is null and p.deletion_batch_id is null and p.deleted_at = ${root.deleted_at})
            )
          order by p.id for update of p`,
    );
    const pageIds = pagesResult.rows.map((row) => row.id);
    let parentId: string | null = null;
    if (root.parent_id) {
      const parent = await executeQuery(
        tx,
        sql`select id from folders where id = ${root.parent_id} and is_deleted = false for share`,
      );
      if ((parent.rowCount ?? 0) > 0) parentId = root.parent_id;
    }
    const position = await getNextPosition('folders', parentId, userId, tx);
    await executeQuery(
      tx,
      sql`update folders
          set is_deleted = false, deleted_at = null, deletion_batch_id = null,
              parent_id = ${parentId}, created_by = ${parentId ? root.created_by : userId},
              position = ${position}, updated_at = now()
          where id = ${folderId} and is_deleted = true`,
    );
    const descendants = folderIds.filter((id) => id !== folderId);
    if (descendants.length > 0) {
      await executeQuery(
        tx,
        sql`update folders set is_deleted = false, deleted_at = null, deletion_batch_id = null,
                updated_at = now()
            where id = any(${sql.param(descendants)}::uuid[]) and is_deleted = true`,
      );
    }
    if (pageIds.length > 0) {
      await executeQuery(
        tx,
        sql`update pages set is_deleted = false, deleted_at = null, deletion_batch_id = null,
                updated_at = now()
            where id = any(${sql.param(pageIds)}::uuid[]) and is_deleted = true`,
      );
    }
    const affectedAfter = await getEntityMetaUserIds(tx, 'folder', folderId);
    await notifyShareRecompute(
      {
        entityType: 'folder',
        entityId: folderId,
        metaUserIds: mergeMetaUserIds(affectedBefore, affectedAfter),
      },
      tx,
    );
    const updated = await executeQuery<FolderDatabaseRowWithOwner>(
      tx,
      sql`select f.*, get_root_folder_owner(f.id) as owner_id from folders f where f.id = ${folderId}`,
    );
    const row = updated.rows[0];
    if (!row) throw new HTTPException(500, { message: 'Failed to restore folder' });
    return {
      ...normalizeFolderRow(row, row.owner_id),
      restoredFolders: folderIds.length,
      restoredPages: pageIds.length,
    };
  });
}

export async function permanentlyDeleteFolder(folderId: string, userId: string) {
  const deleted = await query<{ owner_id: string | null }>(
    sql`select ${deletedFolderOwnerSql} as owner_id
        from folders f where f.id = ${folderId} and f.is_deleted = true`,
  );
  if (!deleted.rows[0]) {
    const active = await query<{ owner_id: string | null }>(
      sql`select get_root_folder_owner(id) as owner_id
          from folders where id = ${folderId} and is_deleted = false`,
    );
    if (!active.rows[0]) throw new HTTPException(404, { message: 'Folder not found' });
    if (active.rows[0].owner_id !== userId) {
      throw new HTTPException(403, {
        message: 'You can only permanently delete folders that you own',
      });
    }
    throw new HTTPException(409, {
      message: 'Folder must be moved to Trash before it can be permanently deleted',
    });
  }
  if (deleted.rows[0].owner_id !== userId) {
    throw new HTTPException(403, {
      message: 'You can only permanently delete folders that you own',
    });
  }
  const result = await db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, userId);
    const locked = await executeQuery<{ owner_id: string | null }>(
      tx,
      sql`select ${deletedFolderOwnerSql} as owner_id
          from folders f where f.id = ${folderId} and f.is_deleted = true for update`,
    );
    if (!locked.rows[0]) throw new HTTPException(404, { message: 'Folder not found' });
    if (locked.rows[0].owner_id !== userId) {
      throw new HTTPException(403, {
        message: 'You can only permanently delete folders that you own',
      });
    }
    return purgeFolderSubtrees(tx, [folderId]);
  });
  return result;
}
