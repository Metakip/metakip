import type { Logger } from '@logtape/logtape';
import {
  extractIndexedPageConnections,
  type IndexedPageConnection,
  normalizeWikiLinkLookupKey,
} from '@metakip/shared';
import type { PoolClient } from 'pg';
import { isUuid } from './utils';

type PageLookupRow = { id: string; title: string };
type PageContextRow = { owner_id: string; properties: unknown };

export type ConnectionResolutionPrincipal = {
  userId: string;
  isAnonymous: boolean;
};

async function resolvePageTargets(
  client: PoolClient,
  ownerId: string,
  connections: IndexedPageConnection[],
  principals: ConnectionResolutionPrincipal[],
  staleTargets?: Map<string, string>,
): Promise<void> {
  const authenticatedUserIds = [
    ...new Set(
      principals.filter((principal) => !principal.isAnonymous).map((principal) => principal.userId),
    ),
  ];
  const hasAnonymousPrincipal = principals.some((principal) => principal.isAnonymous);
  const ids = [
    ...new Set(
      connections
        .filter((connection) => connection.targetType === 'page' && connection.targetId)
        .map((connection) => connection.targetId)
        .filter(isUuid)
        .concat(...(staleTargets ? [...staleTargets.values()].filter(isUuid) : [])),
    ),
  ];
  const slugs = [
    ...new Set(
      connections
        .filter((connection) => connection.targetType === 'page')
        .map((connection) => connection.targetSlug)
        .filter(Boolean),
    ),
  ];
  const byId = new Map<string, PageLookupRow>();
  const bySlug = new Map<string, PageLookupRow>();

  if (ids.length > 0) {
    const result = await client.query<PageLookupRow>(
      `select p.id, p.title
       from pages p
       where p.id = any($1::uuid[])
         and p.is_deleted = false
         and coalesce(get_root_folder_owner(p.parent_id), p.created_by) = $2`,
      [ids, ownerId],
    );
    for (const row of result.rows) byId.set(row.id, row);
  }

  if (principals.length > 0 && slugs.length > 0) {
    const result = await client.query<PageLookupRow & { candidate_value: string }>(
      `with recursive visible_folders as materialized (
         select f.id, f.parent_id, f.name
         from folders f
         where f.is_deleted = false
           and get_root_folder_owner(f.id) = $1
           and not exists (
             select 1 from unnest($2::uuid[]) actor(user_id)
             where not exists (
               select 1 from get_enumerable_folder_ids(actor.user_id) enumerable
               where enumerable.folder_id = f.id
             )
           )
           and (not $3::boolean or get_public_folder_permission(f.id) is not null)
       ), folder_paths as (
         select f.id, trim(f.name)::text as folder_path
         from visible_folders f
         where not exists (select 1 from visible_folders parent where parent.id = f.parent_id)
         union all
         select child.id, (parent.folder_path || '/' || trim(child.name))::text
         from visible_folders child
         join folder_paths parent on parent.id = child.parent_id
       ), workspace_pages as materialized (
         select p.id, p.title, p.parent_id
         from pages p
         where p.is_deleted = false
           and coalesce(get_root_folder_owner(p.parent_id), p.created_by) = $1
           and not exists (
             select 1 from unnest($2::uuid[]) actor(user_id)
             where not exists (
               select 1 from get_accessible_page_ids(actor.user_id) accessible
               where accessible.page_id = p.id
             )
           )
           and (not $3::boolean or get_public_page_permission(p.id) is not null)
       ), candidate_values as (
         select p.id, p.title, p.title::text as candidate_value from workspace_pages p
         union all
         select p.id, p.title, (paths.folder_path || '/' || p.title)::text
         from workspace_pages p
         join folder_paths paths on paths.id = p.parent_id
         where not $3::boolean
       )
       select candidate.id, candidate.title, candidate.candidate_value
       from candidate_values candidate`,
      [ownerId, authenticatedUserIds, hasAnonymousPrincipal],
    );
    const slugSet = new Set(slugs);
    const candidates = new Map<string, Map<string, PageLookupRow>>();
    for (const row of result.rows) {
      const normalizedKey = normalizeWikiLinkLookupKey(row.candidate_value);
      if (!slugSet.has(normalizedKey)) continue;
      const matches = candidates.get(normalizedKey) ?? new Map<string, PageLookupRow>();
      matches.set(row.id, row);
      candidates.set(normalizedKey, matches);
    }
    for (const [normalizedKey, matches] of candidates) {
      if (matches.size !== 1) continue;
      const match = matches.values().next().value;
      if (match) bySlug.set(normalizedKey, match);
    }
  }

  for (const connection of connections) {
    if (connection.targetType !== 'page') continue;
    const idMatch = connection.targetId ? byId.get(connection.targetId.toLowerCase()) : undefined;
    if (idMatch) {
      connection.targetId = idMatch.id;
      connection.targetLabel = idMatch.title;
      continue;
    }
    connection.targetId = null;
    const staleId = staleTargets?.get(connection.targetSlug);
    const staleMatch = staleId ? byId.get(staleId) : undefined;
    if (staleId && staleMatch) {
      connection.targetId = staleId;
      connection.targetLabel = staleMatch.title;
      continue;
    }
    const slugMatch = bySlug.get(connection.targetSlug);
    if (slugMatch) {
      connection.targetId = slugMatch.id;
      connection.targetLabel = slugMatch.title;
    }
  }
}

export async function updateConnections(
  client: PoolClient,
  pageId: string,
  ydocUpdate: Uint8Array,
  resolutionPrincipals: ConnectionResolutionPrincipal[],
  logger: Logger,
): Promise<string[]> {
  const pageResult = await client.query<PageContextRow>(
    `select coalesce(get_root_folder_owner(parent_id), created_by) as owner_id, properties
     from pages where id = $1`,
    [pageId],
  );
  const page = pageResult.rows[0];
  if (!page) {
    logger.warn(`[connections] page ${pageId} not found, skipping connection update`);
    return [];
  }

  const existingResult = await client.query<{
    target_slug: string;
    target_id: string | null;
  }>(
    `select target_slug, target_id from connections
     where source_type = 'page' and source_id = $1 and target_type = 'page'`,
    [pageId],
  );
  const staleTargets = new Map<string, string>();
  const previousTargetPageIds = new Set<string>();
  for (const row of existingResult.rows) {
    if (row.target_slug && row.target_id && !staleTargets.has(row.target_slug)) {
      staleTargets.set(row.target_slug, row.target_id);
    }
    if (row.target_id) previousTargetPageIds.add(row.target_id);
  }

  const indexedConnections = extractIndexedPageConnections(ydocUpdate, page.properties);
  await resolvePageTargets(
    client,
    page.owner_id,
    indexedConnections,
    resolutionPrincipals,
    staleTargets,
  );
  await client.query('select replace_page_connection_index($1, $2::jsonb)', [
    pageId,
    JSON.stringify(indexedConnections),
  ]);

  logger.debug(`[connections] updated ${indexedConnections.length} connections for page ${pageId}`);
  return [
    ...new Set([
      ...previousTargetPageIds,
      ...indexedConnections
        .filter(
          (connection): connection is IndexedPageConnection & { targetId: string } =>
            connection.targetType === 'page' && !!connection.targetId,
        )
        .map((connection) => connection.targetId),
    ]),
  ];
}
