import type { SharePermission } from '@metakip/shared';
import { type SQL, sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor, query } from '../db/query';
import { enumerableFolderPathsCte } from './enumerableFolderPaths';
import {
  type NormalizedPageRow,
  normalizePageRow,
  type PageDatabaseRowWithOwner,
} from './pageRows';

export type AccessiblePageRow = Pick<
  PageDatabaseRowWithOwner,
  | 'id'
  | 'parent_id'
  | 'title'
  | 'icon'
  | 'cover_type'
  | 'cover_value'
  | 'properties'
  | 'created_at'
  | 'updated_at'
  | 'owner_id'
> & { enumerable_parent_id: string | null; permission: SharePermission | null };

export type AccessiblePagePathRow = AccessiblePageRow & {
  title_search: string | null;
  folder_path: string;
};

export const pageMetadataSelection = sql`p.id,
  p.parent_id,
  p.title,
  p.icon,
  p.cover_type,
  p.cover_value,
  p.properties,
  p.created_at,
  p.updated_at`;

export function accessiblePagePathsCte(userId: string): SQL {
  return sql`${enumerableFolderPathsCte(userId)},
    accessible_page_paths as (
      select ${pageMetadataSelection},
        p.title_search,
        coalesce(get_root_folder_owner(p.parent_id), p.created_by) as owner_id,
        case when paths.id is null then null else p.parent_id end as enumerable_parent_id,
        access.permission,
        case when paths.path is null then '/' else '/' || paths.path end as folder_path
      from pages p
      join lateral get_effective_page_permission(p.id, ${userId}) access on true
      left join folder_paths paths on paths.id = p.parent_id
      where p.is_deleted = false
        and p.id in (select page_id from get_accessible_page_ids(${userId}))
        and access.permission is not null
    )`;
}

export async function getPageById(
  pageId: string,
  executor?: QueryExecutor,
): Promise<NormalizedPageRow | null> {
  const statement = sql`select p.*,
      coalesce(get_root_folder_owner(p.parent_id), p.created_by) as owner_id
    from pages p where p.id = ${pageId} and p.is_deleted = false limit 1`;
  const result = executor
    ? await executeQuery<PageDatabaseRowWithOwner>(executor, statement)
    : await query<PageDatabaseRowWithOwner>(statement);
  const row = result.rows[0];
  return row ? normalizePageRow(row, row.owner_id) : null;
}

export async function getPageByIdForUpdate(
  pageId: string,
  executor: QueryExecutor,
): Promise<NormalizedPageRow | null> {
  const result = await executeQuery<PageDatabaseRowWithOwner>(
    executor,
    sql`select p.*, coalesce(get_root_folder_owner(p.parent_id), p.created_by) as owner_id
      from pages p
      where p.id = ${pageId} and p.is_deleted = false
      limit 1
      for update of p`,
  );
  const row = result.rows[0];
  return row ? normalizePageRow(row, row.owner_id) : null;
}

export async function getAccessiblePageById(
  pageId: string,
  userId: string,
  executor?: QueryExecutor,
): Promise<AccessiblePageRow | null> {
  const statement = sql`select ${pageMetadataSelection},
      coalesce(get_root_folder_owner(p.parent_id), p.created_by) as owner_id,
      case
        when p.parent_id in (select folder_id from get_enumerable_folder_ids(${userId}))
        then p.parent_id
        else null
      end as enumerable_parent_id,
      access.permission
    from pages p
    join lateral get_effective_page_permission(p.id, ${userId}) access on true
    where p.id = ${pageId} and p.is_deleted = false and access.permission is not null
    limit 1`;
  const result = executor
    ? await executeQuery<AccessiblePageRow>(executor, statement)
    : await query<AccessiblePageRow>(statement);
  return result.rows[0] ?? null;
}
