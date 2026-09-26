import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, query } from '../db/query';
import { deletedPageOwnerSql } from './deletedEntityOwner';
import { purgeEntityAccessMetadata } from './entityCleanup';
import {
  ensureCanAdminEntity,
  lockEntityAccessMutation,
  lockWorkspaceAccessMutation,
  type ShareEntityType,
} from './share-access';
import { notifyShareRevoke } from './share-notify';
import { getEntityMetaUserIds } from './shareRecipients';
import { purgeUnreferencedUploadsForPages } from './uploadCleanup';

export type FolderTrashResult =
  | { deleted: true }
  | { requiresForce: true; childFolders: number; childPages: number };

async function requireEntityOwner(
  entityType: ShareEntityType,
  entityId: string,
): Promise<string | null> {
  const result =
    entityType === 'page'
      ? await query<{ owner_id: string | null }>(
          sql`select coalesce(get_root_folder_owner(parent_id), created_by) as owner_id
              from pages where id = ${entityId} and is_deleted = false`,
        )
      : await query<{ owner_id: string | null }>(
          sql`select get_root_folder_owner(id) as owner_id
              from folders where id = ${entityId} and is_deleted = false`,
        );
  const row = result.rows[0];
  if (!row) {
    throw new HTTPException(404, {
      message: `${entityType === 'page' ? 'Page' : 'Folder'} not found`,
    });
  }
  return row.owner_id;
}

export async function movePageToTrash(pageId: string, userId: string): Promise<void> {
  await requireEntityOwner('page', pageId);
  await ensureCanAdminEntity('page', pageId, userId);

  await db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, 'page', pageId);
    await ensureCanAdminEntity('page', pageId, userId, tx);
    const metaUserIds = await getEntityMetaUserIds(tx, 'page', pageId);
    const updateResult = await executeQuery(
      tx,
      sql`update pages
          set is_deleted = true, deleted_at = now(), deletion_batch_id = gen_random_uuid(),
              updated_at = now()
          where id = ${pageId} and is_deleted = false
          returning id`,
    );
    if ((updateResult.rowCount ?? 0) === 0) {
      throw new HTTPException(409, { message: 'Page was deleted concurrently' });
    }
    await executeQuery(tx, sql`select pg_notify(${'page_deleted'}, ${JSON.stringify({ pageId })})`);
    await notifyShareRevoke({ entityType: 'page', entityId: pageId, metaUserIds }, tx);
  });
}

export async function permanentlyDeletePage(pageId: string, userId: string): Promise<void> {
  const deleted = await query<{ owner_id: string | null }>(
    sql`select ${deletedPageOwnerSql} as owner_id
        from pages p where p.id = ${pageId} and p.is_deleted = true`,
  );
  const deletedOwnerId = deleted.rows[0]?.owner_id;
  if (!deletedOwnerId) {
    const active = await query<{ owner_id: string | null }>(
      sql`select ${deletedPageOwnerSql} as owner_id
          from pages p where p.id = ${pageId} and p.is_deleted = false`,
    );
    if (!active.rows[0]) throw new HTTPException(404, { message: 'Page not found' });
    if (active.rows[0].owner_id !== userId) {
      throw new HTTPException(403, {
        message: 'You can only permanently delete pages that you own',
      });
    }
    throw new HTTPException(409, {
      message: 'Page must be moved to Trash before it can be permanently deleted',
    });
  }
  if (deletedOwnerId !== userId) {
    throw new HTTPException(403, { message: 'You can only permanently delete pages that you own' });
  }

  await db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, userId);
    const lockedPage = await executeQuery<{ owner_id: string | null }>(
      tx,
      sql`select ${deletedPageOwnerSql} as owner_id
          from pages p where p.id = ${pageId} and p.is_deleted = true for update`,
    );
    const ownerId = lockedPage.rows[0]?.owner_id;
    if (!ownerId) throw new HTTPException(404, { message: 'Page not found' });
    if (ownerId !== userId) {
      throw new HTTPException(403, {
        message: 'You can only permanently delete pages that you own',
      });
    }
    await purgeUnreferencedUploadsForPages(tx, [pageId]);
    await purgeEntityAccessMetadata(tx, 'page', [pageId]);
    await executeQuery(tx, sql`delete from pages where id = ${pageId} and is_deleted = true`);
  });
}

export async function moveFolderToTrash(
  folderId: string,
  userId: string,
  force: boolean,
): Promise<FolderTrashResult> {
  await requireEntityOwner('folder', folderId);
  await ensureCanAdminEntity('folder', folderId, userId);

  return db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, 'folder', folderId);
    const lockedRoot = await executeQuery(
      tx,
      sql`select id from folders where id = ${folderId} and is_deleted = false for update`,
    );
    if ((lockedRoot.rowCount ?? 0) === 0) {
      throw new HTTPException(404, { message: 'Folder not found' });
    }

    await ensureCanAdminEntity('folder', folderId, userId, tx);
    const metaUserIds = await getEntityMetaUserIds(tx, 'folder', folderId);
    const lockedFolderIds = new Set<string>([folderId]);
    while (true) {
      const subtree = await executeQuery<{ id: string }>(
        tx,
        sql`select f.id
            from folder_closure fc
            join folders f on f.id = fc.descendant_id and f.is_deleted = false
            where fc.ancestor_id = ${folderId}
            order by f.id
            for update of f`,
      );
      const previousSize = lockedFolderIds.size;
      for (const row of subtree.rows) lockedFolderIds.add(row.id);
      if (lockedFolderIds.size === previousSize) break;
    }

    const childFolderIds = [...lockedFolderIds].filter((id) => id !== folderId);
    const descendantPages = await executeQuery<{ id: string }>(
      tx,
      sql`select p.id
          from pages p
          where p.parent_id = any(${sql.param([...lockedFolderIds])}::uuid[])
            and p.is_deleted = false
          order by p.id
          for update of p`,
    );
    const childPageIds = descendantPages.rows.map((row) => row.id);
    const inaccessibleDescendants = await executeQuery(
      tx,
      sql`select 1
          from folders f
          join lateral get_effective_folder_permission(f.id, ${userId}) access on true
          where f.id = any(${sql.param(childFolderIds)}::uuid[])
            and not coalesce(access.full_access or access.permission = 'admin', false)
          union all
          select 1
          from pages p
          join lateral get_effective_page_permission(p.id, ${userId}) access on true
          where p.id = any(${sql.param(childPageIds)}::uuid[])
            and not coalesce(access.full_access or access.permission = 'admin', false)
          limit 1`,
    );
    if ((inaccessibleDescendants.rowCount ?? 0) > 0) {
      throw new HTTPException(403, {
        message: 'This folder contains restricted items you do not have admin access to',
      });
    }

    if ((childFolderIds.length > 0 || childPageIds.length > 0) && !force) {
      return {
        requiresForce: true,
        childFolders: childFolderIds.length,
        childPages: childPageIds.length,
      };
    }

    const deletionBatchId = randomUUID();
    if (childFolderIds.length > 0) {
      await executeQuery(
        tx,
        sql`update folders
            set is_deleted = true, deleted_at = now(), deletion_batch_id = ${deletionBatchId},
                updated_at = now()
            where id = any(${sql.param(childFolderIds)}::uuid[])`,
      );
    }
    if (childPageIds.length > 0) {
      await executeQuery(
        tx,
        sql`update pages
            set is_deleted = true, deleted_at = now(), deletion_batch_id = ${deletionBatchId},
                updated_at = now()
            where id = any(${sql.param(childPageIds)}::uuid[])`,
      );
    }
    const updateResult = await executeQuery(
      tx,
      sql`update folders
          set is_deleted = true, deleted_at = now(), deletion_batch_id = ${deletionBatchId},
              updated_at = now()
          where id = ${folderId} and is_deleted = false
          returning id`,
    );
    if ((updateResult.rowCount ?? 0) === 0) {
      throw new HTTPException(409, { message: 'Folder was deleted concurrently' });
    }
    await executeQuery(
      tx,
      sql`select pg_notify(${'folder_deleted'}, ${JSON.stringify({ folderId })})`,
    );
    await notifyShareRevoke({ entityType: 'folder', entityId: folderId, metaUserIds }, tx);
    return { deleted: true };
  });
}

async function removeEntityFromView(
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
): Promise<void> {
  const ownerId = await requireEntityOwner(entityType, entityId);
  if (ownerId === userId) {
    throw new HTTPException(400, {
      message: `Cannot leave your own ${entityType}`,
    });
  }

  await db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, entityType, entityId);
    const shareResult = await executeQuery<{ recipient_user_id: string }>(
      tx,
      sql`delete from shares
          where entity_type = ${entityType} and entity_id = ${entityId}
            and recipient_user_id = ${userId}
          returning recipient_user_id`,
    );
    const eventResult =
      entityType === 'page'
        ? await executeQuery(
            tx,
            sql`delete from page_public_access_visits
                where page_id = ${entityId} and user_id = ${userId}
                returning id`,
          )
        : await executeQuery(
            tx,
            sql`delete from folder_public_access_visits
                where folder_id = ${entityId} and user_id = ${userId}
                returning id`,
          );
    const shareRow = shareResult.rows[0];
    if (!shareRow && (eventResult.rowCount ?? 0) === 0) {
      throw new HTTPException(409, {
        message:
          entityType === 'page'
            ? 'This page is inherited from a folder or workspace and cannot be left directly'
            : 'This folder is inherited from a parent or workspace and cannot be left directly',
      });
    }
    await notifyShareRevoke(
      {
        entityType,
        entityId,
        targetUserId: shareRow?.recipient_user_id ?? userId,
        ...(ownerId ? { metaUserIds: [ownerId] } : {}),
      },
      tx,
    );
  });
}

export const removePageFromView = (pageId: string, userId: string): Promise<void> =>
  removeEntityFromView('page', pageId, userId);

export const removeFolderFromView = (folderId: string, userId: string): Promise<void> =>
  removeEntityFromView('folder', folderId, userId);
