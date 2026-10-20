import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor, query } from '../db/query';
import { deletedPageOwnerSql } from './deletedEntityOwner';
import { getEnumerableFolderIds, redactParentId } from './folderEnumeration';
import {
  ensureActorCanCreateInFolder,
  ensureActorPageAccess,
  persistGuestIdentity,
  type RequestActor,
} from './guestAccess';
import { copyPageContent } from './pageCopy';
import { getPageById } from './pageRepository';
import {
  type NormalizedPageRow,
  normalizePageRow,
  type PageDatabaseRow,
  type PageDatabaseRowWithOwner,
} from './pageRows';
import { getNextPosition, normalizePosition } from './position';
import {
  ensureFolderAccess,
  ensurePageAccess,
  ensureWorkspaceAdmin,
  lockEntityAccess,
  lockEntityAccessMutations,
  lockWorkspaceAccessMutation,
} from './share-access';
import { notifyShareRecompute } from './share-notify';
import { getEntityMetaUserIds, mergeMetaUserIds } from './shareRecipients';

export async function copyPageForActor(
  actor: RequestActor,
  pageId: string,
  parentId: string | null,
) {
  if (!parentId && actor.kind === 'guest') {
    throw new HTTPException(401, { message: 'Log in to copy a page to the workspace root' });
  }
  return db.transaction(async (tx) => {
    await lockEntityAccessMutations(
      tx,
      [
        { entityType: 'page', entityId: pageId },
        ...(parentId ? [{ entityType: 'folder' as const, entityId: parentId }] : []),
      ],
      parentId ? [] : [actor.id],
    );
    const currentPage = await getPageById(pageId, tx);
    if (!currentPage) throw new HTTPException(404, { message: 'Page not found' });
    await ensureActorPageAccess(actor, pageId, 'view', tx);
    if (parentId) await ensureActorCanCreateInFolder(actor, parentId, tx);
    await persistGuestIdentity(actor, tx);
    const copiedPage = await copyPageContent(tx, currentPage, parentId, actor);
    const metaUserIds = await getEntityMetaUserIds(tx, 'page', copiedPage.id);
    await notifyShareRecompute(
      { entityType: 'page', entityId: copiedPage.id, metaUserIds, metaOnly: true },
      tx,
    );
    return copiedPage;
  });
}

export async function ensurePageOrganizationAccess(
  page: NormalizedPageRow,
  parentId: string | null,
  userId: string,
  executor: QueryExecutor,
): Promise<void> {
  if (!page.ownerId)
    throw new HTTPException(409, { message: 'Page owner could not be determined' });
  if (parentId === page.id) throw new HTTPException(400, { message: 'Cannot set parent to self' });
  await ensurePageAccess(page.id, userId, 'admin', executor);
  if (page.parentId) await ensureFolderAccess(page.parentId, userId, 'admin', executor);
  else await ensureWorkspaceAdmin(page.ownerId, userId, executor);

  let destinationOwnerId: string | null = page.createdBy;
  if (parentId) {
    const owner = await executeQuery<{ owner_id: string | null }>(
      executor,
      sql`select get_root_folder_owner(id) as owner_id
          from folders where id = ${parentId} and is_deleted = false`,
    );
    destinationOwnerId = owner.rows[0]?.owner_id ?? null;
    if (!destinationOwnerId) throw new HTTPException(404, { message: 'Parent folder not found' });
    await ensureFolderAccess(parentId, userId, 'admin', executor);
  } else if (destinationOwnerId) {
    await ensureWorkspaceAdmin(destinationOwnerId, userId, executor);
  }
  if (destinationOwnerId !== page.ownerId) {
    throw new HTTPException(409, { message: 'Pages cannot be moved between different owners' });
  }
}

export async function movePageForUser(pageId: string, parentId: string | null, userId: string) {
  return organizePageForUser(pageId, userId, { parentId });
}

export async function organizePageForUser(
  pageId: string,
  userId: string,
  request: { parentId?: string | null | undefined; position?: string | number | undefined },
) {
  return db.transaction(async (tx) => {
    const workspaceOwnerId = await lockEntityAccess(tx, 'page', pageId);
    const currentPage = await getPageById(pageId, tx);
    if (!currentPage) throw new HTTPException(404, { message: 'Page not found' });
    const parentId = request.parentId === undefined ? currentPage.parentId : request.parentId;
    await ensurePageOrganizationAccess(currentPage, parentId, userId, tx);
    const accessChanged = parentId !== currentPage.parentId;
    if (accessChanged) await lockWorkspaceAccessMutation(tx, workspaceOwnerId);
    const affectedBefore = accessChanged ? await getEntityMetaUserIds(tx, 'page', pageId) : [];
    const position =
      request.position !== undefined
        ? normalizePosition(request.position, currentPage.position)
        : request.parentId === undefined
          ? currentPage.position
          : await getNextPosition('pages', parentId, userId, tx);
    const result = await executeQuery<PageDatabaseRow>(
      tx,
      sql`update pages set parent_id = ${parentId}, position = ${position}, updated_at = now()
          where id = ${pageId} and is_deleted = false returning *`,
    );
    const row = result.rows[0];
    if (!row) throw new HTTPException(404, { message: 'Page not found' });
    if (accessChanged) {
      const affectedAfter = await getEntityMetaUserIds(tx, 'page', pageId);
      await notifyShareRecompute(
        {
          entityType: 'page',
          entityId: pageId,
          metaUserIds: mergeMetaUserIds(affectedBefore, affectedAfter),
        },
        tx,
      );
    }
    const enumerableFolderIds = await getEnumerableFolderIds(userId, tx);
    const normalized = normalizePageRow(row, currentPage.ownerId);
    return { ...normalized, parentId: redactParentId(normalized.parentId, enumerableFolderIds) };
  });
}

export async function listTrashedPagesForUser(userId: string) {
  const result = await query<PageDatabaseRowWithOwner>(
    sql`select p.*, ${deletedPageOwnerSql} as owner_id
        from pages p
        left join folders parent on parent.id = p.parent_id
        where p.is_deleted = true
          and ${deletedPageOwnerSql} = ${userId}
          and coalesce(parent.is_deleted, false) = false
        order by p.deleted_at desc nulls last, p.position::numeric asc`,
  );
  return result.rows.map((row) => normalizePageRow(row, row.owner_id));
}

export async function restorePageForUser(pageId: string, userId: string) {
  return db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, userId);
    const locked = await executeQuery<{
      parent_id: string | null;
      created_by: string | null;
      owner_id: string | null;
    }>(
      tx,
      sql`select p.parent_id, p.created_by, ${deletedPageOwnerSql} as owner_id
          from pages p where p.id = ${pageId} and p.is_deleted = true for update`,
    );
    const page = locked.rows[0];
    if (!page) throw new HTTPException(404, { message: 'Page not found' });
    if (page.owner_id !== userId) {
      throw new HTTPException(403, { message: 'You can only restore pages that you own' });
    }
    const affectedBefore = await getEntityMetaUserIds(tx, 'page', pageId);
    let parentId: string | null = null;
    if (page.parent_id) {
      const parent = await executeQuery(
        tx,
        sql`select id from folders where id = ${page.parent_id} and is_deleted = false for share`,
      );
      if ((parent.rowCount ?? 0) > 0) parentId = page.parent_id;
    }
    const position = await getNextPosition('pages', parentId, userId, tx);
    const restored = await executeQuery<PageDatabaseRow>(
      tx,
      sql`update pages
          set is_deleted = false, deleted_at = null, deletion_batch_id = null,
              parent_id = ${parentId}, created_by = ${parentId ? page.created_by : userId},
              position = ${position}, updated_at = now()
          where id = ${pageId} and is_deleted = true returning *`,
    );
    const row = restored.rows[0];
    if (!row) throw new HTTPException(409, { message: 'Page was restored concurrently' });
    const affectedAfter = await getEntityMetaUserIds(tx, 'page', pageId);
    await notifyShareRecompute(
      {
        entityType: 'page',
        entityId: pageId,
        metaUserIds: mergeMetaUserIds(affectedBefore, affectedAfter),
      },
      tx,
    );
    return normalizePageRow(row, parentId ? page.owner_id : userId);
  });
}
