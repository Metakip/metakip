import {
  buildWikiLinkResolution,
  type WikiLinkLookupRow,
  type WikiLinkResolution,
} from '@metakip/shared';
import type { Pool } from 'pg';

type QueryExecutor = Pick<Pool, 'query'>;

export type WikiLinkAccess = WikiLinkResolution;

/**
 * Build link resolution data from pages the requester can enumerate in one
 * workspace. Paths include only visible folder ancestry, preventing a direct
 * page grant from exposing hidden parent folder names.
 */
export async function getWikiLinkAccess(
  executor: QueryExecutor,
  workspaceOwnerId: string,
  requesterUserId: string,
): Promise<WikiLinkAccess> {
  const result = await executor.query<WikiLinkLookupRow>(
    `with recursive enumerable_folders as materialized (
       select enumerable.folder_id
       from get_enumerable_folder_ids($2) enumerable
     ),
     accessible_pages as materialized (
       select accessible.page_id
       from get_accessible_page_ids($2) accessible
     ),
     visible_folders as materialized (
       select f.id, f.parent_id, f.name
       from folders f
       where f.is_deleted = false
         and get_root_folder_owner(f.id) = $1
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
     select p.id as "pageId",
            p.title,
            case
              when paths.folder_path is null then null
              else paths.folder_path || '/' || p.title
            end as "pagePath"
     from pages p
     left join folder_paths paths on paths.id = p.parent_id
     where p.is_deleted = false
       and coalesce(get_root_folder_owner(p.parent_id), p.created_by) = $1
       and p.id in (select page_id from accessible_pages)`,
    [workspaceOwnerId, requesterUserId],
  );

  return buildWikiLinkResolution(result.rows);
}
