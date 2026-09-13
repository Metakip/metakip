import type { Document, Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import { parsePageMetaRoomName, type SharePermission } from '@metakip/shared';
import type { Pool, PoolClient } from 'pg';

export type ActiveMetaDocuments = Map<string, Document>;
export type PageMeta = {
  title: string;
  icon: string | null;
  parent_id: string | null;
  position: string;
};
type PageMetaIndexRow = PageMeta & { id: string; permission: SharePermission };
export type MetadataQueryExecutor = Pick<PoolClient, 'query'>;

export function getActiveMetaDocuments(hocuspocus: Hocuspocus): ActiveMetaDocuments {
  const documents = new Map<string, Document>();
  for (const [documentName, document] of hocuspocus.documents) {
    const userId = parsePageMetaRoomName(documentName);
    if (!userId) continue;
    documents.set(userId, document as Document);
  }
  return documents;
}

export async function rebuildPageMetaDocument(
  executor: MetadataQueryExecutor,
  userId: string,
  document: Document,
  logger: Logger,
  invalidateBacklinks = false,
): Promise<boolean> {
  const result = await executor.query<PageMetaIndexRow>(
    `select p.id, p.title, p.icon,
            case
              when p.parent_id is null or exists (
                select 1 from get_enumerable_folder_ids($1) enumerable
                where enumerable.folder_id = p.parent_id
              ) then p.parent_id
              else null
            end as parent_id,
            p.position, access.permission
     from pages p
     join lateral get_effective_page_permission(p.id, $1) access on true
     where p.is_deleted = false
       and p.id in (select page_id from get_accessible_page_ids($1))
     order by p.position::numeric asc`,
    [userId],
  );

  const nextIds = new Set(result.rows.map((row) => row.id));
  const pageIndex = document.getMap('pageIndex');
  const permissionIndex = document.getMap<SharePermission>('accessPermissions');
  const membershipChanged =
    pageIndex.size !== nextIds.size || Array.from(pageIndex.keys()).some((id) => !nextIds.has(id));
  const permissionChanged =
    permissionIndex.size !== nextIds.size ||
    result.rows.some((row) => permissionIndex.get(row.id) !== row.permission);

  document.transact(() => {
    const backlinksVersion = invalidateBacklinks ? document.getMap('backlinksVersion') : undefined;
    const refreshVersion = Date.now();
    for (const id of pageIndex.keys()) {
      if (!nextIds.has(id)) pageIndex.delete(id);
    }
    for (const id of permissionIndex.keys()) {
      if (!nextIds.has(id)) permissionIndex.delete(id);
    }
    for (const row of result.rows) {
      const nextMeta = {
        title: row.title,
        icon: row.icon,
        parentId: row.parent_id,
        position: row.position,
      };
      const currentMeta = pageIndex.get(row.id) as Partial<typeof nextMeta> | undefined;
      if (
        currentMeta?.title !== nextMeta.title ||
        currentMeta.icon !== nextMeta.icon ||
        currentMeta.parentId !== nextMeta.parentId ||
        currentMeta.position !== nextMeta.position
      ) {
        pageIndex.set(row.id, nextMeta);
      }
      if (permissionIndex.get(row.id) !== row.permission) {
        permissionIndex.set(row.id, row.permission);
      }
      backlinksVersion?.set(row.id, refreshVersion);
    }
  });

  logger.debug(`[meta] loaded ${result.rows.length} pages for user ${userId}`);
  return membershipChanged || permissionChanged;
}

export async function getPageMetaRecipients(
  pool: Pool,
  pageIds: string[],
  candidateUserIds: string[],
): Promise<Map<string, string[]>> {
  if (pageIds.length === 0 || candidateUserIds.length === 0) return new Map();
  const result = await pool.query<{ page_id: string; user_id: string }>(
    `with requested as (
       select distinct unnest($1::uuid[]) as page_id
     ), active_users as (
       select distinct unnest($2::uuid[]) as user_id
     )
     select requested.page_id, active_users.user_id
     from requested
     cross join active_users
     where exists (
       select 1 from get_accessible_page_ids(active_users.user_id) accessible
       where accessible.page_id = requested.page_id
     )`,
    [pageIds, candidateUserIds],
  );
  const recipients = new Map<string, string[]>();
  for (const row of result.rows) {
    const ids = recipients.get(row.page_id) ?? [];
    ids.push(row.user_id);
    recipients.set(row.page_id, ids);
  }
  return recipients;
}

export async function getDeletedPageMetaRecipientIds(
  executor: MetadataQueryExecutor,
  pageId: string,
  candidateUserIds: string[],
): Promise<string[]> {
  if (candidateUserIds.length === 0) return [];
  const result = await executor.query<{ user_id: string }>(
    `with page_info as (
       select coalesce(
         (
           select root.created_by
           from folder_closure fc
           join folders root on root.id = fc.ancestor_id
           where fc.descendant_id = p.parent_id and root.parent_id is null
           order by fc.depth desc
           limit 1
         ),
         p.created_by
       ) as owner_id, p.parent_id
       from pages p where p.id = $1
     ), recipients as (
       select owner_id as user_id from page_info
       union
       select s.recipient_user_id from shares s
       where s.entity_type = 'page' and s.entity_id = $1 and s.recipient_user_id is not null
       union
       select s.recipient_user_id
       from shares s
       join page_info pi on s.entity_id in (
         select ancestor_id from folder_closure where descendant_id = pi.parent_id
       )
       where s.entity_type = 'folder' and s.recipient_user_id is not null
       union
       select wm.member_id from workspace_members wm
       join page_info pi on pi.owner_id = wm.workspace_owner_id
       union
       select user_id from page_public_access_visits where page_id = $1
       union
       select visit.user_id
       from folder_public_access_visits visit
       join page_info pi on visit.folder_id in (
         select ancestor_id from folder_closure where descendant_id = pi.parent_id
       )
     )
     select distinct user_id from recipients
     where user_id is not null and user_id = any($2::uuid[])`,
    [pageId, candidateUserIds],
  );
  return result.rows.map((row) => row.user_id);
}

export async function getDeletedFolderMetaRecipientIds(
  executor: MetadataQueryExecutor,
  folderId: string,
  candidateUserIds: string[],
): Promise<string[]> {
  if (candidateUserIds.length === 0) return [];
  const result = await executor.query<{ user_id: string }>(
    `with folder_info as (
       select coalesce(
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
       from folders f where f.id = $1
     ), related_folders as (
       select ancestor_id as folder_id from folder_closure where descendant_id = $1
       union
       select descendant_id as folder_id from folder_closure where ancestor_id = $1
     ), recipients as (
       select owner_id as user_id from folder_info
       union
       select s.recipient_user_id from shares s
       where s.entity_type = 'folder'
         and s.entity_id in (select folder_id from related_folders)
         and s.recipient_user_id is not null
       union
       select wm.member_id from workspace_members wm
       join folder_info fi on fi.owner_id = wm.workspace_owner_id
       union
       select visit.user_id from folder_public_access_visits visit
       where visit.folder_id in (select folder_id from related_folders)
     )
     select distinct user_id from recipients
     where user_id is not null and user_id = any($2::uuid[])`,
    [folderId, candidateUserIds],
  );
  return result.rows.map((row) => row.user_id);
}

export async function updatePageMeta(
  hocuspocus: Hocuspocus,
  pool: Pool,
  pageId: string,
  logger: Logger,
  known: {
    page?: PageMeta;
    recipients?: Map<string, string[]>;
    activeDocuments?: ActiveMetaDocuments;
  } = {},
): Promise<void> {
  const activeDocuments = known.activeDocuments ?? getActiveMetaDocuments(hocuspocus);
  if (activeDocuments.size === 0) return;

  let page = known.page;
  if (!page) {
    const pageResult = await pool.query<PageMeta>(
      'select title, icon, parent_id, position from pages where id = $1 and is_deleted = false',
      [pageId],
    );
    page = pageResult.rows[0];
  }
  if (!page) return;

  const recipients =
    known.recipients ??
    (await getPageMetaRecipients(pool, [pageId], Array.from(activeDocuments.keys())));
  const recipientIds = recipients.get(pageId) ?? [];
  const parentVisibleTo = new Set<string>();
  if (page.parent_id && recipientIds.length > 0) {
    const visibility = await pool.query<{ user_id: string }>(
      `select requested.user_id
       from unnest($1::uuid[]) requested(user_id)
       where exists (
         select 1 from get_enumerable_folder_ids(requested.user_id) enumerable
         where enumerable.folder_id = $2
       )`,
      [recipientIds, page.parent_id],
    );
    for (const row of visibility.rows) parentVisibleTo.add(row.user_id);
  }

  const failures: unknown[] = [];
  for (const recipientId of recipientIds) {
    const metaDoc = activeDocuments.get(recipientId);
    if (!metaDoc) continue;
    try {
      metaDoc.transact(() => {
        metaDoc.getMap('pageIndex').set(pageId, {
          title: page.title,
          icon: page.icon,
          parentId: parentVisibleTo.has(recipientId) ? page.parent_id : null,
          position: page.position,
        });
      });
    } catch (error) {
      failures.push(error);
      logger.error(
        `[meta] failed to update meta for user ${recipientId} on page ${pageId}: ${error}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `Failed to update page metadata for ${pageId}`);
  }
}

export async function updateBacklinksVersion(
  hocuspocus: Hocuspocus,
  pool: Pool,
  pageIds: string[],
  logger: Logger,
  known: {
    recipients?: Map<string, string[]>;
    activeDocuments?: ActiveMetaDocuments;
  } = {},
): Promise<void> {
  if (pageIds.length === 0) return;
  const activeDocuments = known.activeDocuments ?? getActiveMetaDocuments(hocuspocus);
  if (activeDocuments.size === 0) return;

  const pageIdsByRecipient = new Map<string, string[]>();
  const recipientsByPage =
    known.recipients ??
    (await getPageMetaRecipients(pool, pageIds, Array.from(activeDocuments.keys())));
  for (const pageId of pageIds) {
    for (const recipientId of recipientsByPage.get(pageId) ?? []) {
      const ids = pageIdsByRecipient.get(recipientId) ?? [];
      ids.push(pageId);
      pageIdsByRecipient.set(recipientId, ids);
    }
  }

  const failures: unknown[] = [];
  for (const [recipientId, recipientPageIds] of pageIdsByRecipient) {
    const metaDoc = activeDocuments.get(recipientId);
    if (!metaDoc) continue;
    try {
      metaDoc.transact(() => {
        const versions = metaDoc.getMap<number>('backlinksVersion');
        const now = Date.now();
        for (const id of recipientPageIds) {
          const current = versions.get(id);
          versions.set(id, current === undefined ? now : Math.max(now, current + 1));
        }
      });
    } catch (error) {
      failures.push(error);
      logger.error(`[meta] failed to update backlinksVersion for user ${recipientId}: ${error}`);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to update backlinks metadata');
  }
}
