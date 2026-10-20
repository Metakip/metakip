import type { V1SearchSnippet, V1SearchTextMatch } from '@metakip/shared';
import { type SQL, sql } from 'drizzle-orm';
import { query } from '../db/query';
import { enumerableFolderPathsCte } from '../utils/enumerableFolderPaths';
import { type AccessiblePagePathRow, accessiblePagePathsCte } from '../utils/pageRepository';
import type { PageSearchHit } from './meilisearch';

export type HydratedFolderSearchRow = {
  id: string;
  enumerable_parent_id: string | null;
  name: string;
  icon: string | null;
  owner_id: string | null;
  permission: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  folder_path: string;
  folder_path_segments: string[];
};

export type HydratedSearchResult =
  | {
      type: 'page';
      row: AccessiblePagePathRow;
      titleMatches?: V1SearchTextMatch[];
      snippet?: V1SearchSnippet;
    }
  | { type: 'folder'; row: HydratedFolderSearchRow; titleMatches?: V1SearchTextMatch[] };

export type SearchHydrationOptions = {
  includeFolders?: boolean;
  pageFilters?: readonly SQL[];
  folderFilters?: readonly SQL[];
};

function combineFilters(filters: readonly SQL[] | undefined): SQL {
  return filters && filters.length > 0
    ? sql`and ${sql.join([...filters], sql` and `)}`
    : sql.empty();
}

/** Hydrates ordered Meilisearch hits and rechecks access against PostgreSQL. */
export async function hydrateSearchResults(
  userId: string,
  hits: PageSearchHit[],
  options: SearchHydrationOptions = {},
): Promise<HydratedSearchResult[]> {
  const pageIds = hits.filter((hit) => hit.type === 'page').map((hit) => hit.entityId);
  const folderIds = hits.filter((hit) => hit.type === 'folder').map((hit) => hit.entityId);
  const [pageRows, folderRows] = await Promise.all([
    pageIds.length === 0
      ? Promise.resolve({ rows: [] as AccessiblePagePathRow[] })
      : query<AccessiblePagePathRow>(sql`
          ${accessiblePagePathsCte(userId)}
          select p.*
          from accessible_page_paths p
          where p.id = any(${sql.param(pageIds)}::uuid[])
            ${combineFilters(options.pageFilters)}
          order by array_position(${sql.param(pageIds)}::uuid[], p.id)
          limit ${pageIds.length}
        `),
    folderIds.length === 0 || options.includeFolders === false
      ? Promise.resolve({ rows: [] as HydratedFolderSearchRow[] })
      : query<HydratedFolderSearchRow>(sql`
          ${enumerableFolderPathsCte(userId)}
          select f.id,
            case
              when f.parent_id in (
                select folder_id from get_enumerable_folder_ids(${userId})
              ) then f.parent_id
              else null
            end as enumerable_parent_id,
            f.name, f.icon, get_root_folder_owner(f.id) as owner_id,
            access.permission, f.created_at, f.updated_at,
            case when paths.path is null then '/' else '/' || paths.path end as folder_path,
            coalesce(paths.path_segments, array[f.name]::text[]) as folder_path_segments
          from folders f
          join lateral get_effective_folder_permission(f.id, ${userId}) access on true
          left join folder_paths paths on paths.id = f.id
          where f.is_deleted = false
            and f.id in (select folder_id from get_enumerable_folder_ids(${userId}))
            and access.permission is not null
            and f.id = any(${sql.param(folderIds)}::uuid[])
            ${combineFilters(options.folderFilters)}
          order by array_position(${sql.param(folderIds)}::uuid[], f.id)
          limit ${folderIds.length}
        `),
  ]);

  const pagesById = new Map(pageRows.rows.map((row) => [row.id, row]));
  const foldersById = new Map(folderRows.rows.map((row) => [row.id, row]));
  const hydrated: HydratedSearchResult[] = [];

  for (const hit of hits) {
    if (hit.type === 'page') {
      const row = pagesById.get(hit.entityId);
      if (row) {
        const titleMatches =
          hit.titleHighlight?.text === row.title ? hit.titleHighlight.matches : [];
        hydrated.push({
          type: 'page',
          row,
          ...(titleMatches.length > 0 ? { titleMatches } : {}),
          ...(hit.snippet ? { snippet: hit.snippet } : {}),
        });
      }
    } else {
      const row = foldersById.get(hit.entityId);
      if (row) {
        const titleMatches =
          hit.titleHighlight?.text === row.name ? hit.titleHighlight.matches : [];
        hydrated.push({
          type: 'folder',
          row,
          ...(titleMatches.length > 0 ? { titleMatches } : {}),
        });
      }
    }
  }

  return hydrated;
}
