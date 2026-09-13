import type { CollaboratorDisplay, EntityAccessor, EntityAccessSource } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor } from '../db/query';
import type { ShareEntityType, SharePermission } from './share-access';

type SourceRow = {
  entity_id: string;
  kind: 'owner' | 'direct' | 'folder' | 'workspace';
  share_id: string | null;
  user_id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  permission: SharePermission;
  folder_id: string | null;
  folder_name: string | null;
};

const permissionRank = (permission: SharePermission): number =>
  permission === 'admin' ? 3 : permission === 'edit' ? 2 : 1;

export async function getAccessSourcesByEntityIds(
  entityType: ShareEntityType,
  entityIds: readonly string[],
  executor: QueryExecutor,
): Promise<Map<string, EntityAccessSource[]>> {
  const byEntity = new Map(entityIds.map((entityId) => [entityId, [] as EntityAccessSource[]]));
  if (entityIds.length === 0) return byEntity;
  const requestedIds = sql.join(
    entityIds.map((entityId) => sql`${entityId}`),
    sql`, `,
  );

  const result =
    entityType === 'page'
      ? await executeQuery<SourceRow>(
          executor,
          sql`with requested as (
             select unnest(array[${requestedIds}]::uuid[]) as entity_id
           ), page_info as (
             select page.id as entity_id, page.parent_id,
                    coalesce(get_root_folder_owner(page.parent_id), page.created_by) as owner_id
             from requested
             join pages page on page.id = requested.entity_id and page.is_deleted = false
           ), sources as (
             select info.entity_id, 'owner'::text as kind, null::uuid as share_id,
                    info.owner_id as user_id, 'admin'::text as permission,
                    null::uuid as folder_id, null::text as folder_name
             from page_info info where info.owner_id is not null

             union all

             select info.entity_id, 'direct', share.id, share.recipient_user_id,
                    share.permission, null, null
             from page_info info
             join shares share on share.entity_type = 'page' and share.entity_id = info.entity_id

             union all

             select info.entity_id, 'folder', share.id, share.recipient_user_id,
                    share.permission, folder.id, folder.name
             from page_info info
             join folder_closure path on path.descendant_id = info.parent_id
             join folders folder on folder.id = path.ancestor_id and folder.is_deleted = false
             join shares share on share.entity_type = 'folder' and share.entity_id = folder.id
             where not is_page_folder_inheritance_blocked(folder.id, info.entity_id)

             union all

             select info.entity_id, 'workspace', null, member.member_id,
                    case member.role when 'viewer' then 'view' when 'editor' then 'edit' else 'admin' end,
                    null, null
             from page_info info
             join workspace_members member on member.workspace_owner_id = info.owner_id
             where not is_page_path_restricted(info.entity_id)
           )
           select sources.entity_id, sources.kind, sources.share_id, sources.user_id,
                  users.name, users.email, coalesce(users.avatar_url, users.image) as avatar_url,
                  sources.permission, sources.folder_id, sources.folder_name
           from sources join users on users.id = sources.user_id`,
        )
      : await executeQuery<SourceRow>(
          executor,
          sql`with requested as (
             select unnest(array[${requestedIds}]::uuid[]) as entity_id
           ), folder_info as (
             select folder.id as entity_id, get_root_folder_owner(folder.id) as owner_id
             from requested
             join folders folder on folder.id = requested.entity_id and folder.is_deleted = false
           ), sources as (
             select info.entity_id, 'owner'::text as kind, null::uuid as share_id,
                    info.owner_id as user_id, 'admin'::text as permission,
                    null::uuid as folder_id, null::text as folder_name
             from folder_info info where info.owner_id is not null

             union all

             select info.entity_id, 'direct', share.id, share.recipient_user_id,
                    share.permission, null, null
             from folder_info info
             join shares share on share.entity_type = 'folder' and share.entity_id = info.entity_id

             union all

             select info.entity_id, 'folder', share.id, share.recipient_user_id,
                    share.permission, folder.id, folder.name
             from folder_info info
             join folder_closure path on path.descendant_id = info.entity_id and path.depth > 0
             join folders folder on folder.id = path.ancestor_id and folder.is_deleted = false
             join shares share on share.entity_type = 'folder' and share.entity_id = folder.id
             where not is_folder_inheritance_blocked(folder.id, info.entity_id)

             union all

             select info.entity_id, 'workspace', null, member.member_id,
                    case member.role when 'viewer' then 'view' when 'editor' then 'edit' else 'admin' end,
                    null, null
             from folder_info info
             join workspace_members member on member.workspace_owner_id = info.owner_id
             where not is_folder_path_restricted(info.entity_id)
           )
           select sources.entity_id, sources.kind, sources.share_id, sources.user_id,
                  users.name, users.email, coalesce(users.avatar_url, users.image) as avatar_url,
                  sources.permission, sources.folder_id, sources.folder_name
           from sources join users on users.id = sources.user_id`,
        );

  const winningPermission = new Map<string, SharePermission>();
  for (const row of result.rows) {
    const key = `${row.entity_id}:${row.user_id}`;
    const current = winningPermission.get(key);
    if (!current || permissionRank(row.permission) > permissionRank(current)) {
      winningPermission.set(key, row.permission);
    }
  }

  for (const row of result.rows) {
    const effectivePermission =
      winningPermission.get(`${row.entity_id}:${row.user_id}`) ?? row.permission;
    byEntity.get(row.entity_id)?.push({
      kind: row.kind,
      grantId: row.share_id,
      userId: row.user_id,
      name: row.name,
      email: row.email,
      avatarUrl: row.avatar_url,
      permission: row.permission,
      effectivePermission,
      isWinning: row.permission === effectivePermission,
      isOwner: row.kind === 'owner',
      isManageable: row.kind === 'direct',
      ...(row.folder_id ? { folderId: row.folder_id, folderName: row.folder_name } : {}),
    });
  }

  const kindOrder = { owner: 0, direct: 1, folder: 2, workspace: 3 } as const;
  for (const sources of byEntity.values()) {
    sources.sort(
      (left, right) =>
        kindOrder[left.kind] - kindOrder[right.kind] ||
        (left.name ?? left.email ?? '').localeCompare(right.name ?? right.email ?? ''),
    );
  }
  return byEntity;
}

export async function getAccessSources(
  entityType: ShareEntityType,
  entityId: string,
  executor: QueryExecutor,
): Promise<EntityAccessSource[]> {
  return (await getAccessSourcesByEntityIds(entityType, [entityId], executor)).get(entityId) ?? [];
}

export function getAccessors(sources: readonly EntityAccessSource[]): EntityAccessor[] {
  const byUser = new Map<string, EntityAccessor>();
  for (const source of sources) {
    const current = byUser.get(source.userId);
    if (
      current &&
      permissionRank(current.permission) >= permissionRank(source.effectivePermission)
    ) {
      continue;
    }
    byUser.set(source.userId, {
      grantId: source.kind === 'direct' ? source.grantId : null,
      userId: source.userId,
      name: source.name,
      email: source.email,
      avatarUrl: source.avatarUrl,
      permission: source.effectivePermission,
      source:
        source.kind === 'owner'
          ? 'Owner'
          : source.kind === 'direct'
            ? 'Direct grant'
            : source.kind === 'folder'
              ? `Inherited from ${source.folderName ?? 'folder'}`
              : 'Workspace',
      isOwner: source.isOwner,
    });
  }
  return [...byUser.values()];
}

export function toCollaboratorDisplays(
  accessors: readonly EntityAccessor[],
): CollaboratorDisplay[] {
  return accessors.map(({ userId, name, avatarUrl, permission, isOwner }) => ({
    userId,
    name,
    avatarUrl,
    permission,
    isOwner,
  }));
}
