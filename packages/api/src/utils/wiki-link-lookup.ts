import { buildWikiLinkResolution } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';

/**
 * Build a lookup for the pages one requester can enumerate in one effective
 * workspace. Unqualified titles are included only when unique among those
 * pages. Explicit paths use only requester-visible folder ancestry, so a
 * direct page grant cannot be used to probe hidden parent folder names.
 */
export async function getUniqueWorkspacePageLookup(
  ownerId: string,
  requesterUserId: string,
  executor: QueryExecutor = db,
): Promise<Map<string, string>> {
  const result = await executeQuery<{
    page_id: string;
    title: string;
    page_path: string | null;
  }>(
    executor,
    sql`with recursive enumerable_folders as materialized (
       select enumerable.folder_id
       from get_enumerable_folder_ids(${requesterUserId}) enumerable
     ),
     accessible_pages as materialized (
       select accessible.page_id
       from get_accessible_page_ids(${requesterUserId}) accessible
     ),
     visible_folders as materialized (
       select f.id, f.parent_id, f.name
       from folders f
       where f.is_deleted = false
         and get_root_folder_owner(f.id) = ${ownerId}
         and f.id in (select folder_id from enumerable_folders)
     ),
     folder_paths as (
       select f.id, trim(f.name)::text as folder_path
       from visible_folders f
       where not exists (
         select 1 from visible_folders parent where parent.id = f.parent_id
       )

       union all

       select child.id,
              (parent.folder_path || '/' || trim(child.name))::text as folder_path
       from visible_folders child
       join folder_paths parent on parent.id = child.parent_id
     )
     select p.id as page_id,
            p.title,
            case
              when paths.folder_path is null then null
              else paths.folder_path || '/' || p.title
            end as page_path
     from pages p
     left join folder_paths paths on paths.id = p.parent_id
     where p.is_deleted = false
       and coalesce(get_root_folder_owner(p.parent_id), p.created_by) = ${ownerId}
       and p.id in (select page_id from accessible_pages)`,
  );

  return buildWikiLinkResolution(
    result.rows.map((row) => ({
      pageId: row.page_id,
      title: row.title,
      pagePath: row.page_path,
    })),
  ).pageLookup;
}
