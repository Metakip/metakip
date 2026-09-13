import type { Document, Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import {
  COLLAB_TERMINAL_REASONS,
  type EntityDeletedMessage,
  type WorkspaceMembershipMessage,
} from '@metakip/shared';
import type { Pool, PoolClient } from 'pg';
import { rebuildActivePageMetaDocuments } from './metadataPublications';
import {
  getActiveMetaDocuments,
  getDeletedFolderMetaRecipientIds,
  getDeletedPageMetaRecipientIds,
  updateBacklinksVersion,
} from './pageMetadata';
import { isUuid } from './utils';
import { broadcastWikiLinkPresentationInvalidation } from './wikiLinkInvalidation';

type DeletionEntity = 'page' | 'folder';
type DeletionState = { is_deleted: boolean; owner_id: string | null };

async function getDeletionState(
  client: PoolClient,
  entityType: DeletionEntity,
  entityId: string,
): Promise<DeletionState | undefined> {
  const result =
    entityType === 'page'
      ? await client.query<DeletionState>(
          `select p.is_deleted,
                  coalesce(
                    (
                      select root.created_by
                      from folder_closure fc
                      join folders root on root.id = fc.ancestor_id
                      where fc.descendant_id = p.parent_id and root.parent_id is null
                      order by fc.depth desc
                      limit 1
                    ),
                    (select parent.created_by from folders parent where parent.id = p.parent_id),
                    p.created_by
                  ) as owner_id
           from pages p
           where p.id = $1`,
          [entityId],
        )
      : await client.query<DeletionState>(
          `select f.is_deleted,
                  coalesce(
                    (
                      select root.created_by
                      from folder_closure fc
                      join folders root on root.id = fc.ancestor_id
                      where fc.descendant_id = f.id and root.parent_id is null
                      order by fc.depth desc
                      limit 1
                    ),
                    f.created_by
                  ) as owner_id
           from folders f
           where f.id = $1`,
          [entityId],
        );
  return result.rows[0];
}

/** Serialize canonical deletion publication with API lifecycle mutations. */
async function publishCanonicalDeletion(
  pool: Pool,
  entityType: DeletionEntity,
  entityId: string,
  publish: (client: PoolClient, missing: boolean) => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = await pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      const beforeLock = await getDeletionState(client, entityType, entityId);
      if (beforeLock) {
        if (!beforeLock.owner_id) {
          throw new Error(`Cannot resolve workspace owner for ${entityType} ${entityId}`);
        }
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `workspace-access:${beforeLock.owner_id}`,
        ]);
      }

      const current = beforeLock ? await getDeletionState(client, entityType, entityId) : undefined;
      if (current?.owner_id && beforeLock?.owner_id && current.owner_id !== beforeLock.owner_id) {
        await client.query('ROLLBACK');
        transactionOpen = false;
        continue;
      }
      if (current && !current.is_deleted) {
        await client.query('COMMIT');
        transactionOpen = false;
        return false;
      }

      await publish(client, current === undefined);
      await client.query('COMMIT');
      transactionOpen = false;
      return true;
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  throw new Error(`Workspace owner changed repeatedly for ${entityType} ${entityId}`);
}

function closeDeletedPageConnections(hocuspocus: Hocuspocus, pageId: string): void {
  const activeDoc = hocuspocus.documents.get(pageId) as Document | undefined;
  if (!activeDoc) return;
  for (const connection of activeDoc.getConnections()) {
    connection.sendStateless(
      JSON.stringify({
        type: 'entity_deleted',
        entityType: 'page',
        entityId: pageId,
      } satisfies EntityDeletedMessage),
    );
    connection.close({ code: 4402, reason: COLLAB_TERMINAL_REASONS.PAGE_DELETED });
  }
}

export async function publishPageDeletion(
  hocuspocus: Hocuspocus,
  pool: Pool,
  pageId: string,
  logger: Logger,
): Promise<void> {
  const published = await publishCanonicalDeletion(
    pool,
    'page',
    pageId,
    async (client, missing) => {
      const activeDocuments = getActiveMetaDocuments(hocuspocus);
      const previousTargetPageIds = missing
        ? []
        : (
            await client.query<{ target_id: string }>(
              `select distinct target_id
               from connections
               where source_type = 'page' and source_id = $1
                 and target_type = 'page' and target_id is not null`,
              [pageId],
            )
          ).rows.map((row) => row.target_id);
      let recipientIds: string[];
      try {
        recipientIds = missing
          ? Array.from(activeDocuments)
              .filter(([, document]) => {
                return (
                  document.getMap('pageIndex').has(pageId) ||
                  document.getMap('accessPermissions').has(pageId) ||
                  document.getMap('backlinksVersion').has(pageId)
                );
              })
              .map(([recipientId]) => recipientId)
          : await getDeletedPageMetaRecipientIds(
              client,
              pageId,
              Array.from(activeDocuments.keys()),
            );
      } catch (error) {
        closeDeletedPageConnections(hocuspocus, pageId);
        throw error;
      }
      closeDeletedPageConnections(hocuspocus, pageId);
      const failures: unknown[] = [];
      for (const recipientId of recipientIds) {
        const metaDoc = activeDocuments.get(recipientId);
        if (!metaDoc) continue;
        try {
          metaDoc.transact(() => {
            metaDoc.getMap('pageIndex').delete(pageId);
            metaDoc.getMap('accessPermissions').delete(pageId);
            metaDoc.getMap('backlinksVersion').set(pageId, Date.now());
          });
        } catch (error) {
          failures.push(error);
          logger.error(
            `[listen] failed to remove page ${pageId} from meta for user ${recipientId}: ${error}`,
          );
        }
      }
      try {
        await updateBacklinksVersion(hocuspocus, pool, previousTargetPageIds, logger, {
          activeDocuments,
        });
      } catch (error) {
        failures.push(error);
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, `Failed to publish deletion metadata for ${pageId}`);
      }
    },
  );

  if (published) {
    await broadcastWikiLinkPresentationInvalidation(hocuspocus, pool, {
      targetPageIds: [pageId],
    });
  }
  logger.debug(
    published
      ? `[listen] removed deleted page ${pageId} from active meta rooms`
      : `[listen] ignored stale page deletion for restored page ${pageId}`,
  );
}

export async function publishFolderDeletion(
  hocuspocus: Hocuspocus,
  pool: Pool,
  folderId: string,
  logger: Logger,
): Promise<void> {
  let deletedActivePageCount = 0;
  const published = await publishCanonicalDeletion(
    pool,
    'folder',
    folderId,
    async (client, missing) => {
      const activePageIds = Array.from(hocuspocus.documents.keys()).filter(isUuid);
      const deletedActivePages =
        activePageIds.length === 0
          ? []
          : (
              await client.query<{ id: string }>(
                missing
                  ? `select requested.id
                     from unnest($1::uuid[]) requested(id)
                     left join pages p on p.id = requested.id
                     where p.id is null`
                  : `select requested.id
                     from unnest($2::uuid[]) requested(id)
                     left join pages p on p.id = requested.id
                     where p.id is null
                        or (
                          p.parent_id in (
                            select descendant_id from folder_closure where ancestor_id = $1
                          )
                          and p.is_deleted = true
                        )`,
                missing ? [activePageIds] : [folderId, activePageIds],
              )
            ).rows.map((row) => row.id);
      deletedActivePageCount = deletedActivePages.length;

      const activeDocuments = getActiveMetaDocuments(hocuspocus);
      let recipientIds: string[];
      try {
        recipientIds = missing
          ? []
          : await getDeletedFolderMetaRecipientIds(
              client,
              folderId,
              Array.from(activeDocuments.keys()),
            );
      } catch (error) {
        for (const pageId of deletedActivePages) closeDeletedPageConnections(hocuspocus, pageId);
        throw error;
      }
      for (const pageId of deletedActivePages) closeDeletedPageConnections(hocuspocus, pageId);

      const failures: unknown[] = [];
      try {
        await rebuildActivePageMetaDocuments(hocuspocus, pool, logger, {
          reconcileTitles: false,
          queryExecutor: client,
        });
      } catch (error) {
        failures.push(error);
        logger.error(
          `[listen] failed to rebuild metadata after folder deletion ${folderId}: ${error}`,
        );
      }
      try {
        const message = JSON.stringify({
          type: 'entity_deleted',
          entityType: 'folder',
          entityId: folderId,
        } satisfies EntityDeletedMessage);
        for (const recipientId of recipientIds) {
          const metaDoc = activeDocuments.get(recipientId);
          if (!metaDoc) continue;
          for (const connection of metaDoc.getConnections()) connection.sendStateless(message);
        }
      } catch (error) {
        failures.push(error);
        logger.error(
          `[listen] failed to publish folder metadata deletion for ${folderId}: ${error}`,
        );
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, `Failed to publish all deletion events for ${folderId}`);
      }
    },
  );

  if (published) {
    await broadcastWikiLinkPresentationInvalidation(hocuspocus, pool, { folderId });
  }
  logger.debug(
    published
      ? `[listen] published folder deletion and closed ${deletedActivePageCount} active page(s) for ${folderId}`
      : `[listen] ignored stale folder deletion for restored folder ${folderId}`,
  );
}

export async function reconcileDeletionOverflow(
  hocuspocus: Hocuspocus,
  pool: Pool,
  logger: Logger,
): Promise<void> {
  const activePageIds = Array.from(hocuspocus.documents.keys()).filter(isUuid);
  if (activePageIds.length > 0) {
    const result = await pool.query<{ id: string }>(
      `SELECT requested.id
       FROM unnest($1::uuid[]) requested(id)
       LEFT JOIN pages p ON p.id = requested.id
       WHERE p.id IS NULL OR p.is_deleted = true`,
      [activePageIds],
    );
    for (const row of result.rows) closeDeletedPageConnections(hocuspocus, row.id);
  }

  await rebuildActivePageMetaDocuments(hocuspocus, pool, logger, { reconcileTitles: false });
  const invalidationMessage = JSON.stringify({
    type: 'workspace_membership_event',
    action: 'role_changed',
    ownerId: 'all',
  } satisfies WorkspaceMembershipMessage);
  for (const document of getActiveMetaDocuments(hocuspocus).values()) {
    for (const connection of document.getConnections())
      connection.sendStateless(invalidationMessage);
  }
}
