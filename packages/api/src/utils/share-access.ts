import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { executeQuery, type QueryExecutor, query } from '../db/query';

export type ShareEntityType = 'folder' | 'page';
export type SharePermission = 'view' | 'commenter' | 'edit' | 'admin';

type AccessMode = 'view' | 'commenter' | 'edit' | 'admin';

const permissionRank = (permission: SharePermission) =>
  permission === 'admin' ? 4 : permission === 'edit' ? 3 : permission === 'commenter' ? 2 : 1;
const hasRequiredPermission = (permission: SharePermission, mode: AccessMode) => {
  return permissionRank(permission) >= permissionRank(mode);
};

const accessModeLabel = (mode: AccessMode) =>
  mode === 'admin'
    ? 'admin'
    : mode === 'edit'
      ? 'edit'
      : mode === 'commenter'
        ? 'commenter'
        : 'view';

export const parsePermission = (value: unknown): SharePermission => {
  if (value === 'admin') return 'admin';
  if (value === 'edit') return 'edit';
  if (value === 'commenter') return 'commenter';
  if (value === 'view') return 'view';
  throw new HTTPException(400, { message: 'Invalid permission' });
};

export const parsePublicPermission = (value: unknown): 'view' | 'edit' => {
  if (value === 'edit') return 'edit';
  if (value === 'view') return 'view';
  throw new HTTPException(400, { message: 'Invalid public permission' });
};

export const parseEntityType = (value: string): ShareEntityType => {
  if (value === 'folder' || value === 'page') {
    return value;
  }
  throw new HTTPException(400, { message: 'Invalid entity type' });
};

export const ensurePageAccess = async (
  pageId: string,
  userId: string,
  mode: AccessMode = 'view',
  executor?: QueryExecutor,
) => {
  const statement = sql`SELECT * FROM get_effective_page_permission(${pageId}, ${userId})`;
  const result = executor ? await executeQuery(executor, statement) : await query(statement);
  const row = result.rows[0] as { permission: string | null; full_access: boolean } | undefined;

  if (!row || row.permission === null) {
    throw new HTTPException(403, { message: "You don't have access to this page" });
  }

  const permission = row.permission as SharePermission;
  const fullAccess = row.full_access;

  if (fullAccess) {
    return { hasAccess: true, fullAccess: true, permission: 'edit' as SharePermission };
  }

  if (!hasRequiredPermission(permission, mode)) {
    throw new HTTPException(403, {
      message: `You need ${accessModeLabel(mode)} access to access this page`,
    });
  }

  return { hasAccess: true, fullAccess: false, permission };
};

export const ensureFolderAccess = async (
  folderId: string,
  userId: string,
  mode: AccessMode = 'view',
  executor?: QueryExecutor,
) => {
  const statement = sql`SELECT * FROM get_effective_folder_permission(${folderId}, ${userId})`;
  const result = executor ? await executeQuery(executor, statement) : await query(statement);
  const row = result.rows[0] as { permission: string | null; full_access: boolean } | undefined;

  if (!row || row.permission === null) {
    throw new HTTPException(403, { message: "You don't have access to this folder" });
  }

  const permission = row.permission as SharePermission;
  const fullAccess = row.full_access;

  if (fullAccess) {
    return { hasAccess: true, fullAccess: true, permission: 'edit' as SharePermission };
  }

  if (!hasRequiredPermission(permission, mode)) {
    throw new HTTPException(403, {
      message: `You need ${accessModeLabel(mode)} access to access this folder`,
    });
  }

  return { hasAccess: true, fullAccess: false, permission };
};

export const lockWorkspaceAccess = async (
  executor: QueryExecutor,
  workspaceOwnerId: string,
): Promise<void> => {
  await executeQuery(
    executor,
    sql`select pg_advisory_xact_lock_shared(hashtextextended(${`workspace-access:${workspaceOwnerId}`}, 0))`,
  );
};

export const lockWorkspaceAccessMutation = async (
  executor: QueryExecutor,
  workspaceOwnerId: string,
): Promise<void> => {
  await executeQuery(
    executor,
    sql`select pg_advisory_xact_lock(hashtextextended(${`workspace-access:${workspaceOwnerId}`}, 0))`,
  );
  await executeQuery(
    executor,
    sql`insert into workspace_access_versions (workspace_owner_id, version)
     values (${workspaceOwnerId}, nextval('workspace_access_revision_seq'))
     on conflict (workspace_owner_id) do update
     set version = nextval('workspace_access_revision_seq')`,
  );
};

type EntityAccessTarget = { entityType: ShareEntityType; entityId: string };
type ResolvedEntityAccessTarget = EntityAccessTarget & { ownerId: string };
type MissingEntityPolicy = 'omit' | 'reject';

const entityAccessKey = ({ entityType, entityId }: EntityAccessTarget): string =>
  `${entityType}:${entityId.toLowerCase()}`;

const resolveExistingEntityOwners = async (
  executor: QueryExecutor,
  entities: ReadonlyArray<EntityAccessTarget>,
): Promise<Array<ResolvedEntityAccessTarget | null>> => {
  const pageIds = [
    ...new Set(
      entities
        .filter((entity) => entity.entityType === 'page')
        .map((entity) => entity.entityId.toLowerCase()),
    ),
  ];
  const folderIds = [
    ...new Set(
      entities
        .filter((entity) => entity.entityType === 'folder')
        .map((entity) => entity.entityId.toLowerCase()),
    ),
  ];
  const resolvedByEntity = new Map<string, string>();

  if (pageIds.length > 0) {
    const result = await executeQuery<{ entity_id: string; owner_id: string | null }>(
      executor,
      sql`select p.id as entity_id,
                 coalesce(get_root_folder_owner(p.parent_id), p.created_by) as owner_id
          from pages p
          where p.id = any(${sql.param(pageIds)}::uuid[]) and p.is_deleted = false`,
    );
    for (const row of result.rows) {
      if (!row.owner_id) {
        throw new HTTPException(409, { message: 'Entity owner could not be determined' });
      }
      resolvedByEntity.set(
        entityAccessKey({ entityType: 'page', entityId: row.entity_id }),
        row.owner_id,
      );
    }
  }

  if (folderIds.length > 0) {
    const result = await executeQuery<{ entity_id: string; owner_id: string | null }>(
      executor,
      sql`select f.id as entity_id, get_root_folder_owner(f.id) as owner_id
          from folders f
          where f.id = any(${sql.param(folderIds)}::uuid[]) and f.is_deleted = false`,
    );
    for (const row of result.rows) {
      if (!row.owner_id) {
        throw new HTTPException(409, { message: 'Entity owner could not be determined' });
      }
      resolvedByEntity.set(
        entityAccessKey({ entityType: 'folder', entityId: row.entity_id }),
        row.owner_id,
      );
    }
  }

  return entities.map((entity) => {
    const ownerId = resolvedByEntity.get(entityAccessKey(entity));
    return ownerId ? { ...entity, ownerId } : null;
  });
};

const applyMissingEntityPolicy = (
  entities: ReadonlyArray<EntityAccessTarget>,
  resolvedEntities: ReadonlyArray<ResolvedEntityAccessTarget | null>,
  policy: MissingEntityPolicy,
): ResolvedEntityAccessTarget[] => {
  const existing: ResolvedEntityAccessTarget[] = [];
  for (let index = 0; index < resolvedEntities.length; index += 1) {
    const resolved = resolvedEntities[index];
    if (resolved) {
      existing.push(resolved);
      continue;
    }
    if (policy === 'reject') {
      const missing = entities[index];
      if (!missing) throw new Error('Entity owner resolution lost a required entity');
      throw new HTTPException(404, {
        message: missing.entityType === 'page' ? 'Page not found' : 'Folder not found',
      });
    }
  }
  return existing;
};

const lockStableEntityAccess = async (
  executor: QueryExecutor,
  entities: ReadonlyArray<EntityAccessTarget>,
  additionalWorkspaceOwnerIds: readonly string[],
  lockWorkspace: (executor: QueryExecutor, workspaceOwnerId: string) => Promise<void>,
  missingEntityPolicy: MissingEntityPolicy,
): Promise<ResolvedEntityAccessTarget[]> => {
  const initiallyExisting = applyMissingEntityPolicy(
    entities,
    await resolveExistingEntityOwners(executor, entities),
    missingEntityPolicy,
  );
  const ownerIds = initiallyExisting.map((entity) => entity.ownerId);
  const lockedOwnerIds = [...new Set([...ownerIds, ...additionalWorkspaceOwnerIds])].sort();
  for (const ownerId of lockedOwnerIds) {
    await lockWorkspace(executor, ownerId);
  }

  // Supported organization routes never change an entity's workspace owner,
  // but re-resolve after the advisory locks so a future route or direct SQL
  // writer cannot make us continue under only a stale workspace key.
  const currentlyExisting = applyMissingEntityPolicy(
    initiallyExisting,
    await resolveExistingEntityOwners(executor, initiallyExisting),
    missingEntityPolicy,
  );
  const lockedOwnerIdSet = new Set(lockedOwnerIds);
  if (currentlyExisting.some((entity) => !lockedOwnerIdSet.has(entity.ownerId))) {
    throw new HTTPException(409, {
      message: 'Entity workspace changed while acquiring access lock; retry the request',
    });
  }
  return currentlyExisting;
};

export const lockEntityAccesses = async (
  executor: QueryExecutor,
  entities: ReadonlyArray<EntityAccessTarget>,
  options: {
    additionalWorkspaceOwnerIds?: readonly string[];
    missingEntities?: MissingEntityPolicy;
  } = {},
): Promise<ResolvedEntityAccessTarget[]> => {
  return lockStableEntityAccess(
    executor,
    entities,
    options.additionalWorkspaceOwnerIds ?? [],
    lockWorkspaceAccess,
    options.missingEntities ?? 'reject',
  );
};

export const lockEntityAccess = async (
  executor: QueryExecutor,
  entityType: ShareEntityType,
  entityId: string,
): Promise<string> => {
  const entities = await lockEntityAccesses(executor, [{ entityType, entityId }]);
  const lockedEntity = entities[0];
  if (!lockedEntity) throw new Error('Entity access lock did not resolve an owner');
  return lockedEntity.ownerId;
};

export const lockEntityAccessMutations = async (
  executor: QueryExecutor,
  entities: ReadonlyArray<EntityAccessTarget>,
  additionalWorkspaceOwnerIds: readonly string[] = [],
): Promise<ResolvedEntityAccessTarget[]> => {
  return lockStableEntityAccess(
    executor,
    entities,
    additionalWorkspaceOwnerIds,
    lockWorkspaceAccessMutation,
    'reject',
  );
};

export const lockEntityAccessMutation = async (
  executor: QueryExecutor,
  entityType: ShareEntityType,
  entityId: string,
): Promise<string> => {
  const entities = await lockEntityAccessMutations(executor, [{ entityType, entityId }]);
  const lockedEntity = entities[0];
  if (!lockedEntity) throw new Error('Entity access lock did not resolve an owner');
  return lockedEntity.ownerId;
};

export const ensureCanAdminEntity = async (
  entityType: 'page' | 'folder',
  entityId: string,
  userId: string,
  executor?: QueryExecutor,
) => {
  const access =
    entityType === 'page'
      ? await ensurePageAccess(entityId, userId, 'admin', executor)
      : await ensureFolderAccess(entityId, userId, 'admin', executor);

  return { ...access, permission: 'admin' as SharePermission };
};

export const ensureWorkspaceAdmin = async (
  workspaceOwnerId: string,
  userId: string,
  executor?: QueryExecutor,
) => {
  if (workspaceOwnerId === userId) {
    return { fullAccess: true, permission: 'admin' as const };
  }

  const statement = sql`select role from workspace_members
     where workspace_owner_id = ${workspaceOwnerId} and member_id = ${userId}
     limit 1`;
  const result = executor ? await executeQuery(executor, statement) : await query(statement);
  if (result.rows[0]?.role !== 'admin') {
    throw new HTTPException(403, { message: 'You need admin access to manage this workspace' });
  }

  return { fullAccess: false, permission: 'admin' as const };
};
