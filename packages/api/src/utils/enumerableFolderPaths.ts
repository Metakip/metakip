import { type SQL, sql } from 'drizzle-orm';

export function enumerableFolderPathsCte(userId: string): SQL {
  return sql`with recursive
    enumerable_folders as (
      select f.id, f.parent_id, f.name
      from folders f
      where f.is_deleted = false
        and f.id in (select folder_id from get_enumerable_folder_ids(${userId}))
    ),
    folder_paths as (
      select f.id, f.parent_id, f.name, f.name::text as path,
        array[f.name]::text[] as path_segments, array[f.id] as visited
      from enumerable_folders f
      where f.parent_id is null
        or not exists (select 1 from enumerable_folders parent where parent.id = f.parent_id)
      union all
      select child.id, child.parent_id, child.name,
        parent.path || '/' || child.name, array_append(parent.path_segments, child.name),
        parent.visited || child.id
      from enumerable_folders child
      join folder_paths parent on parent.id = child.parent_id
      where not child.id = any(parent.visited)
    )`;
}
