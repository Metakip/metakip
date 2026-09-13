import { randomUUID } from 'node:crypto';
import { MAX_FOLDER_NAME_LENGTH } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor } from '../db/query';
import { type FolderDatabaseRow, type NormalizedFolderRow, normalizeFolderRow } from './folderRows';
import type { RequestActor } from './guestAccess';
import { type PageCopySource, persistPageCopies } from './pageCopy';
import { getNextPosition } from './position';

export type FolderCopyResult = {
  folder: NormalizedFolderRow | null;
  skippedRestrictedItems: boolean;
};
type FolderCopyPage = PageCopySource & {
  copiedParentId: string;
  copyOrder: string;
  position: string;
  effectivePermission: string | null;
};

const FOLDER_INSERT_BATCH_SIZE = 500;
const FOLDER_PAGE_COPY_BATCH_SIZE = 100;
export async function copyFolderRecursive(
  executor: QueryExecutor,
  sourceFolderId: string,
  newParentId: string | null,
  destinationOwnerId: string,
  actor: RequestActor,
  pageConnectionPolicy: 'all' | 'non-page',
): Promise<FolderCopyResult> {
  const folderCopyMap = `folder_copy_map_${randomUUID().replaceAll('-', '')}`;
  await executeQuery(
    executor,
    sql.raw(`create temporary table ${folderCopyMap} (
      source_id uuid primary key,
      copied_id uuid not null unique,
      copy_depth integer not null,
      copy_order bigint not null unique
    ) on commit drop`),
  );
  const populateMap =
    actor.kind === 'user'
      ? sql`with recursive copied_tree as (
           select folder.id, 0 as copy_depth, folder.position
           from folders folder
           join lateral get_effective_folder_permission(folder.id, ${actor.id}) access on true
           where folder.id = ${sourceFolderId} and folder.is_deleted = false
             and access.permission is not null
           union all
           select child.id, parent.copy_depth + 1, child.position
           from folders child
           join copied_tree parent on child.parent_id = parent.id
           join lateral get_effective_folder_permission(child.id, ${actor.id}) access on true
           where child.is_deleted = false and access.permission is not null
         )
         insert into ${sql.raw(folderCopyMap)} (source_id, copied_id, copy_depth, copy_order)
         select id, gen_random_uuid(), copy_depth,
                row_number() over (order by copy_depth, position::numeric, id)
         from copied_tree`
      : sql`with recursive copied_tree as (
           select folder.id, 0 as copy_depth, folder.position
           from folders folder
           where folder.id = ${sourceFolderId} and folder.is_deleted = false
             and get_public_folder_permission(folder.id) is not null
           union all
           select child.id, parent.copy_depth + 1, child.position
           from folders child
           join copied_tree parent on child.parent_id = parent.id
           where child.is_deleted = false
             and get_public_folder_permission(child.id) is not null
         )
         insert into ${sql.raw(folderCopyMap)} (source_id, copied_id, copy_depth, copy_order)
         select id, gen_random_uuid(), copy_depth,
                row_number() over (order by copy_depth, position::numeric, id)
         from copied_tree`;
  await executeQuery(executor, populateMap);
  const mapState = await executeQuery<{ folder_count: string; root_copy_id: string | null }>(
    executor,
    sql`select count(*)::text as folder_count,
               (select copied_id from ${sql.raw(folderCopyMap)}
                where source_id = ${sourceFolderId}) as root_copy_id
        from ${sql.raw(folderCopyMap)}`,
  );
  const folderCount = Number(mapState.rows[0]?.folder_count ?? 0);
  const rootCopyId = mapState.rows[0]?.root_copy_id;
  if (folderCount === 0 || !rootCopyId) {
    return { folder: null, skippedRestrictedItems: true };
  }

  const restrictedResult =
    actor.kind === 'user'
      ? await executeQuery<{ restricted: boolean }>(
          executor,
          sql`select exists (
             select 1 from folders child
             left join lateral get_effective_folder_permission(child.id, ${actor.id}) access on true
             join ${sql.raw(folderCopyMap)} parent on parent.source_id = child.parent_id
             where child.is_deleted = false
               and access.permission is null
           ) as restricted`,
        )
      : await executeQuery<{ restricted: boolean }>(
          executor,
          sql`select exists (
             select 1 from folders child
             join ${sql.raw(folderCopyMap)} parent on parent.source_id = child.parent_id
             where child.is_deleted = false
               and get_public_folder_permission(child.id) is null
           ) as restricted`,
        );
  let skippedRestrictedItems = restrictedResult.rows[0]?.restricted === true;
  const rootPosition = await getNextPosition('folders', newParentId, actor.id, executor);
  for (let offset = 0; offset < folderCount; offset += FOLDER_INSERT_BATCH_SIZE) {
    await executeQuery(
      executor,
      sql`insert into folders (id, parent_id, name, icon, position, created_by)
       select mapping.copied_id,
              case when mapping.source_id = ${sourceFolderId}
                   then ${newParentId} else parent_mapping.copied_id end,
              left('Copy of ' || coalesce(nullif(btrim(source.name), ''), 'New Folder'), ${MAX_FOLDER_NAME_LENGTH}),
              source.icon,
              case when mapping.source_id = ${sourceFolderId}
                   then ${rootPosition} else source.position end,
              ${actor.kind === 'user' ? actor.id : null}
       from ${sql.raw(folderCopyMap)} mapping
       join folders source on source.id = mapping.source_id
       left join ${sql.raw(folderCopyMap)} parent_mapping
         on parent_mapping.source_id = source.parent_id
       where mapping.copy_order > ${offset}
         and mapping.copy_order <= ${offset + FOLDER_INSERT_BATCH_SIZE}
       order by mapping.copy_order`,
    );
  }
  const insertedRoot = (
    await executeQuery<FolderDatabaseRow>(
      executor,
      sql`select * from folders where id = ${rootCopyId}`,
    )
  ).rows[0];
  if (!insertedRoot) throw new Error('Failed to copy folder');
  const newFolder = normalizeFolderRow(insertedRoot, destinationOwnerId);

  let pageCursor: { copyOrder: string; position: string; id: string } | undefined;
  while (true) {
    const pagesResult =
      actor.kind === 'user'
        ? await executeQuery<FolderCopyPage>(
            executor,
            sql`select p.id, p.title, p.icon, p.cover_type as "coverType",
                      p.cover_value as "coverValue", mapping.copied_id as "copiedParentId",
                      mapping.copy_order::text as "copyOrder", p.position, p.ydoc, p.properties,
                      access.permission as "effectivePermission"
           from pages p
           join ${sql.raw(folderCopyMap)} mapping on mapping.source_id = p.parent_id
           left join lateral get_effective_page_permission(p.id, ${actor.id}) access on true
           where p.is_deleted = false
             and (${pageCursor?.copyOrder ?? null}::bigint is null or
                  (mapping.copy_order, p.position::numeric, p.id) >
                  (${pageCursor?.copyOrder ?? null}::bigint, ${pageCursor?.position ?? null}::numeric, ${pageCursor?.id ?? null}::uuid))
             order by mapping.copy_order, p.position::numeric asc, p.id
             limit ${FOLDER_PAGE_COPY_BATCH_SIZE}`,
          )
        : await executeQuery<FolderCopyPage>(
            executor,
            sql`select p.id, p.title, p.icon, p.cover_type as "coverType",
                      p.cover_value as "coverValue", mapping.copied_id as "copiedParentId",
                      mapping.copy_order::text as "copyOrder", p.position, p.ydoc, p.properties,
                      get_public_page_permission(p.id) as "effectivePermission"
           from pages p
           join ${sql.raw(folderCopyMap)} mapping on mapping.source_id = p.parent_id
           where p.is_deleted = false
             and (${pageCursor?.copyOrder ?? null}::bigint is null or
                  (mapping.copy_order, p.position::numeric, p.id) >
                  (${pageCursor?.copyOrder ?? null}::bigint, ${pageCursor?.position ?? null}::numeric, ${pageCursor?.id ?? null}::uuid))
             order by mapping.copy_order, p.position::numeric asc, p.id
             limit ${FOLDER_PAGE_COPY_BATCH_SIZE}`,
          );
    if (pagesResult.rows.length === 0) break;
    const lastPage = pagesResult.rows.at(-1);
    if (!lastPage) break;
    pageCursor = {
      copyOrder: lastPage.copyOrder,
      position: lastPage.position,
      id: lastPage.id,
    };
    const accessiblePages = pagesResult.rows.filter((page) => {
      if (page.effectivePermission) return true;
      skippedRestrictedItems = true;
      return false;
    });
    await persistPageCopies(
      executor,
      accessiblePages.map((page) => ({
        source: page,
        options: {
          parentId: page.copiedParentId,
          position: page.position,
          connectionPolicy: pageConnectionPolicy,
        },
      })),
      actor,
    );
  }

  return { folder: newFolder, skippedRestrictedItems };
}
