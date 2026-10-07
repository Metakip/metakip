import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import {
  decideSharingPermission,
  type OraclePermission,
  type OraclePublicPermission,
} from '../test-support/sharingOracle';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../test-utils';

type EntityType = 'page' | 'folder';

type ModelEntity = {
  id: string;
  type: EntityType;
  parentId: string | null;
  grant: OraclePermission;
  publicAccess: OraclePublicPermission;
  restricted: boolean;
  deleted: boolean;
};

type Model = {
  workspace: OraclePermission;
  entities: Map<string, ModelEntity>;
  pageRevisions: Map<string, bigint>;
};

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const accountPermissions: readonly OraclePermission[] = [
  null,
  'view',
  'commenter',
  'edit',
  'admin',
];
const workspacePermissions: readonly OraclePermission[] = [null, 'view', 'edit', 'admin'];
const publicPermissions: readonly OraclePublicPermission[] = [null, 'view', 'edit'];

const seededRandom = (initialSeed: number) => {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

function pick<T>(values: readonly T[], random: () => number): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error('Cannot pick from an empty collection');
  return value;
}

function getEntity(model: Model, entityId: string): ModelEntity {
  const entity = model.entities.get(entityId);
  if (!entity) throw new Error(`Unknown model entity ${entityId}`);
  return entity;
}

function getNodes(model: Model, entity: ModelEntity): ModelEntity[] {
  const nodes = [entity];
  const seen = new Set([entity.id]);
  let parentId = entity.parentId;

  while (parentId) {
    if (seen.has(parentId)) throw new Error(`Cycle in topology model at ${parentId}`);
    const parent = getEntity(model, parentId);
    if (parent.type !== 'folder') throw new Error(`Parent ${parentId} is not a folder`);
    nodes.push(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }

  return nodes;
}

function expectedPermission(
  model: Model,
  entity: ModelEntity,
  sources: 'all' | 'account' | 'public',
): OraclePermission {
  if (entity.deleted) return null;
  const nodes = getNodes(model, entity);
  if (nodes.some((node) => node.deleted)) return null;

  return decideSharingPermission({
    workspace: sources === 'public' ? null : model.workspace,
    nodes: nodes.map((node) => ({
      grant: sources === 'public' ? null : node.grant,
      publicAccess: sources === 'account' ? null : node.publicAccess,
      restricted: node.restricted,
    })),
  }).permission;
}

function expectedSharedRootIds(model: Model): string[] {
  const candidates = [...model.entities.values()].filter(
    (entity) => !entity.deleted && entity.grant !== null,
  );
  const candidateFolders = candidates.filter((entity) => entity.type === 'folder');

  return candidates
    .filter((target) => {
      const nodes = getNodes(model, target);
      return !candidateFolders.some((source) => {
        if (source.id === target.id) return false;
        const sourceIndex = nodes.findIndex((node) => node.id === source.id);
        if (sourceIndex <= 0) return false;
        return !nodes.slice(0, sourceIndex).some((node) => node.restricted);
      });
    })
    .map((entity) => entity.id)
    .sort();
}

async function assertModel(
  model: Model,
  recipientId: string,
  app: TestApp,
  recipientCookie: string,
  label: string,
): Promise<void> {
  const entities = [...model.entities.values()];
  const pageIds = entities.filter((entity) => entity.type === 'page').map((entity) => entity.id);
  const folderIds = entities
    .filter((entity) => entity.type === 'folder')
    .map((entity) => entity.id);

  const storedPages = await query<{
    id: string;
    parent_id: string | null;
    is_deleted: boolean;
    permission: OraclePermission;
    public_permission: OraclePublicPermission;
    access_revision: string;
  }>(
    `select page.id, page.parent_id, page.is_deleted,
            access.permission, get_public_page_permission(page.id) as public_permission,
            get_page_access_revision(page.id)::text as access_revision
     from pages page
     left join lateral get_effective_page_permission(page.id, $2) access on true
     where page.id = any($1::uuid[])`,
    [pageIds, recipientId],
  );
  const storedFolders = await query<{
    id: string;
    parent_id: string | null;
    is_deleted: boolean;
    permission: OraclePermission;
    public_permission: OraclePublicPermission;
    access_revision: string | null;
  }>(
    `select folder.id, folder.parent_id, folder.is_deleted,
            access.permission, get_public_folder_permission(folder.id) as public_permission,
            null::text as access_revision
     from folders folder
     left join lateral get_effective_folder_permission(folder.id, $2) access on true
     where folder.id = any($1::uuid[])`,
    [folderIds, recipientId],
  );

  const rows = new Map(
    [...storedPages.rows, ...storedFolders.rows].map((row) => [row.id, row] as const),
  );
  expect(rows.size, `${label}: stored entity count`).toBe(entities.length);

  for (const entity of entities) {
    const row = rows.get(entity.id);
    expect(row, `${label}: missing ${entity.type} ${entity.id}`).toBeDefined();
    expect(row?.parent_id, `${label}: parent of ${entity.id}`).toBe(entity.parentId);
    expect(row?.is_deleted, `${label}: deletion state of ${entity.id}`).toBe(entity.deleted);
    expect(row?.permission ?? null, `${label}: effective permission of ${entity.id}`).toBe(
      expectedPermission(model, entity, 'all'),
    );
    expect(row?.public_permission ?? null, `${label}: public permission of ${entity.id}`).toBe(
      expectedPermission(model, entity, 'public'),
    );
    if (entity.type === 'page' && row?.access_revision) {
      const revision = BigInt(row.access_revision);
      const previousRevision = model.pageRevisions.get(entity.id);
      if (previousRevision !== undefined) {
        expect(
          revision,
          `${label}: monotonic access revision of ${entity.id}`,
        ).toBeGreaterThanOrEqual(previousRevision);
      }
      model.pageRevisions.set(entity.id, revision);
    }
  }

  const accessiblePages = await query<{ page_id: string }>(
    'select page_id from get_accessible_page_ids($1)',
    [recipientId],
  );
  const expectedPageIds = entities
    .filter(
      (entity) => entity.type === 'page' && expectedPermission(model, entity, 'account') !== null,
    )
    .map((entity) => entity.id)
    .sort();
  expect(
    accessiblePages.rows.map((row) => row.page_id).sort(),
    `${label}: accessible pages`,
  ).toEqual(expectedPageIds);

  const enumerableFolders = await query<{ folder_id: string }>(
    'select folder_id from get_enumerable_folder_ids($1)',
    [recipientId],
  );
  const expectedFolderIds = entities
    .filter(
      (entity) => entity.type === 'folder' && expectedPermission(model, entity, 'account') !== null,
    )
    .map((entity) => entity.id)
    .sort();
  expect(
    enumerableFolders.rows.map((row) => row.folder_id).sort(),
    `${label}: enumerable folders`,
  ).toEqual(expectedFolderIds);

  const sharedRootsResponse = await app.request('/api/shares/with-me', {
    headers: { Cookie: recipientCookie },
  });
  expect(sharedRootsResponse.status, `${label}: Shared With Me status`).toBe(200);
  const sharedRoots = (await sharedRootsResponse.json()) as Array<{ entityId: string }>;
  expect(sharedRoots.map((root) => root.entityId).sort(), `${label}: Shared With Me roots`).toEqual(
    expectedSharedRootIds(model),
  );
}

async function setGrant(
  model: Model,
  entity: ModelEntity,
  ownerId: string,
  recipientId: string,
  permission: OraclePermission,
): Promise<void> {
  await query(
    `delete from shares
     where entity_type = $1 and entity_id = $2 and recipient_user_id = $3`,
    [entity.type, entity.id, recipientId],
  );
  if (permission) {
    await query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ($1, $2, $3, $4, $5)`,
      [entity.type, entity.id, ownerId, recipientId, permission],
    );
  }
  entity.grant = permission;
  model.entities.set(entity.id, entity);
}

async function setPublicAccess(
  model: Model,
  entity: ModelEntity,
  permission: OraclePublicPermission,
): Promise<void> {
  await query(
    entity.type === 'page'
      ? 'update pages set public_permission = $1 where id = $2'
      : 'update folders set public_permission = $1 where id = $2',
    [permission, entity.id],
  );
  entity.publicAccess = permission;
  model.entities.set(entity.id, entity);
}

async function setRestriction(
  model: Model,
  entity: ModelEntity,
  restricted: boolean,
): Promise<void> {
  await query(
    entity.type === 'page'
      ? 'update pages set inheritance_policy = $1 where id = $2'
      : 'update folders set inheritance_policy = $1 where id = $2',
    [restricted ? 'restricted' : 'inherit', entity.id],
  );
  entity.restricted = restricted;
  model.entities.set(entity.id, entity);
}

async function setWorkspaceAccess(
  model: Model,
  ownerId: string,
  recipientId: string,
  permission: OraclePermission,
): Promise<void> {
  await query('delete from workspace_members where workspace_owner_id = $1 and member_id = $2', [
    ownerId,
    recipientId,
  ]);
  if (permission) {
    await query(
      `insert into workspace_members (workspace_owner_id, member_id, role)
       values ($1, $2, $3)`,
      [
        ownerId,
        recipientId,
        permission === 'view' ? 'viewer' : permission === 'edit' ? 'editor' : 'admin',
      ],
    );
  }
  model.workspace = permission;
}

describe('sharing topology state machine', () => {
  it('preserves permissions and enumeration across topology and lifecycle mutations', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const recipientSession = await createTestSession(recipient.id);
    const rootA = await createTestFolder(owner.id, { name: 'Topology root A' });
    const rootB = await createTestFolder(owner.id, { name: 'Topology root B' });
    const branch = await createTestFolder(owner.id, {
      name: 'Topology branch',
      parentId: rootA.id,
    });
    const leaf = await createTestFolder(owner.id, {
      name: 'Topology leaf',
      parentId: branch.id,
    });
    const pageA = await createTestPage(owner.id, {
      title: 'Topology page A',
      parentId: leaf.id,
    });
    const pageB = await createTestPage(owner.id, {
      title: 'Topology page B',
      parentId: rootA.id,
    });

    const model: Model = {
      workspace: null,
      pageRevisions: new Map(),
      entities: new Map(
        [
          { ...rootA, type: 'folder' as const, parentId: null },
          { ...rootB, type: 'folder' as const, parentId: null },
          { ...branch, type: 'folder' as const, parentId: rootA.id },
          { ...leaf, type: 'folder' as const, parentId: branch.id },
          { ...pageA, type: 'page' as const, parentId: leaf.id },
          { ...pageB, type: 'page' as const, parentId: rootA.id },
        ].map((entity) => [
          entity.id,
          {
            id: entity.id,
            type: entity.type,
            parentId: entity.parentId,
            grant: null,
            publicAccess: null,
            restricted: false,
            deleted: false,
          },
        ]),
      ),
    };
    const random = seededRandom(0x70f0109);
    const entityIds = [...model.entities.keys()];
    const pageIds = [pageA.id, pageB.id] as const;
    const movableFolderIds = [branch.id, leaf.id] as const;
    const trace: string[] = [];

    await assertModel(model, recipient.id, app, recipientSession.Cookie, 'initial topology');

    for (let step = 0; step < 80; step += 1) {
      const axis = Math.floor(random() * 7);
      if (axis === 0) {
        const permission = pick(workspacePermissions, random);
        await setWorkspaceAccess(model, owner.id, recipient.id, permission);
        trace.push(`workspace=${permission ?? 'none'}`);
      } else if (axis === 1) {
        const entity = getEntity(model, pick(entityIds, random));
        const permission = pick(accountPermissions, random);
        await setGrant(model, entity, owner.id, recipient.id, permission);
        trace.push(`grant:${entity.id}=${permission ?? 'none'}`);
      } else if (axis === 2) {
        const entity = getEntity(model, pick(entityIds, random));
        const permission = pick(publicPermissions, random);
        await setPublicAccess(model, entity, permission);
        trace.push(`public:${entity.id}=${permission ?? 'none'}`);
      } else if (axis === 3) {
        const entity = getEntity(model, pick(entityIds, random));
        const restricted = random() >= 0.5;
        await setRestriction(model, entity, restricted);
        trace.push(`restricted:${entity.id}=${restricted}`);
      } else if (axis === 4) {
        const page = getEntity(model, pick(pageIds, random));
        const parentId = pick([null, rootA.id, rootB.id, branch.id, leaf.id], random);
        const response = await app.request(`/api/pages/${page.id}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
          body: JSON.stringify({ parentId }),
        });
        expect(response.status, `page move after ${trace.slice(-10).join(' -> ')}`).toBe(200);
        page.parentId = parentId;
        trace.push(`move-page:${page.id}->${parentId ?? 'root'}`);
      } else if (axis === 5) {
        const folder = getEntity(model, branch.id);
        const parentId = pick([rootA.id, rootB.id], random);
        const response = await app.request(`/api/folders/${folder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
          body: JSON.stringify({ parentId }),
        });
        expect(response.status, `branch move after ${trace.slice(-10).join(' -> ')}`).toBe(200);
        folder.parentId = parentId;
        trace.push(`move-branch:${parentId}`);
      } else {
        const folder = getEntity(model, pick(movableFolderIds, random));
        const parentChoices =
          folder.id === branch.id ? [rootA.id, rootB.id] : [rootA.id, rootB.id, branch.id];
        const parentId = pick(parentChoices, random);
        const response = await app.request(`/api/folders/${folder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
          body: JSON.stringify({ parentId }),
        });
        expect(response.status, `folder move after ${trace.slice(-10).join(' -> ')}`).toBe(200);
        folder.parentId = parentId;
        trace.push(`move-folder:${folder.id}->${parentId}`);
      }

      await assertModel(
        model,
        recipient.id,
        app,
        recipientSession.Cookie,
        `seed=0x70f0109 step=${step} trace=${trace.slice(-10).join(' -> ')}`,
      );
    }

    const moveEntity = async (entityId: string, parentId: string): Promise<void> => {
      const entity = getEntity(model, entityId);
      const response = await app.request(
        entity.type === 'page' ? `/api/pages/${entityId}/move` : `/api/folders/${entityId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
          body: JSON.stringify({ parentId }),
        },
      );
      expect(response.status).toBe(200);
      entity.parentId = parentId;
    };

    await moveEntity(branch.id, rootA.id);
    await moveEntity(leaf.id, branch.id);
    await moveEntity(pageA.id, leaf.id);
    await moveEntity(pageB.id, rootB.id);
    await setGrant(model, getEntity(model, branch.id), owner.id, recipient.id, 'edit');
    await setPublicAccess(model, getEntity(model, leaf.id), 'view');
    await assertModel(
      model,
      recipient.id,
      app,
      recipientSession.Cookie,
      'arranged recursive subtree',
    );

    const deleteFolder = await app.request(`/api/folders/${branch.id}?force=true`, {
      method: 'DELETE',
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(deleteFolder.status).toBe(200);
    for (const entityId of [branch.id, leaf.id, pageA.id]) {
      getEntity(model, entityId).deleted = true;
    }
    await assertModel(
      model,
      recipient.id,
      app,
      recipientSession.Cookie,
      'soft-deleted recursive subtree',
    );

    const restoreFolder = await app.request(`/api/folders/${branch.id}/restore`, {
      method: 'PATCH',
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(restoreFolder.status).toBe(200);
    for (const entityId of [branch.id, leaf.id, pageA.id]) {
      getEntity(model, entityId).deleted = false;
    }
    await assertModel(
      model,
      recipient.id,
      app,
      recipientSession.Cookie,
      'restored recursive subtree',
    );

    const deletePage = await app.request(`/api/pages/${pageB.id}`, {
      method: 'DELETE',
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(deletePage.status).toBe(200);
    getEntity(model, pageB.id).deleted = true;
    await assertModel(model, recipient.id, app, recipientSession.Cookie, 'soft-deleted page');

    const restorePage = await app.request(`/api/pages/${pageB.id}/restore`, {
      method: 'PATCH',
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(restorePage.status).toBe(200);
    getEntity(model, pageB.id).deleted = false;
    await assertModel(model, recipient.id, app, recipientSession.Cookie, 'restored page');

    await query(
      `insert into folder_public_access_visits (folder_id, user_id)
       values ($1, $3), ($2, $3)
       on conflict do nothing`,
      [branch.id, leaf.id, recipient.id],
    );
    await query(
      `insert into page_public_access_visits (page_id, user_id)
       values ($1, $2)
       on conflict do nothing`,
      [pageA.id, recipient.id],
    );

    const deleteForPermanent = await app.request(`/api/folders/${branch.id}?force=true`, {
      method: 'DELETE',
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(deleteForPermanent.status).toBe(200);
    const permanentDelete = await app.request(`/api/folders/${branch.id}/permanent`, {
      method: 'DELETE',
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(permanentDelete.status).toBe(200);
    for (const entityId of [branch.id, leaf.id, pageA.id]) model.entities.delete(entityId);
    await assertModel(
      model,
      recipient.id,
      app,
      recipientSession.Cookie,
      'permanently deleted recursive subtree',
    );

    const removedEntities = await query<{ count: string }>(
      `select (
         (select count(*) from folders where id = any($1::uuid[])) +
         (select count(*) from pages where id = $2)
       )::text as count`,
      [[branch.id, leaf.id], pageA.id],
    );
    expect(removedEntities.rows[0]?.count).toBe('0');
    const removedAuthority = await query<{ count: string }>(
      `select (
         (select count(*) from shares where entity_id = any($1::uuid[])) +
         (select count(*) from folder_public_access_visits where folder_id = any($2::uuid[])) +
         (select count(*) from page_public_access_visits where page_id = $3)
       )::text as count`,
      [[branch.id, leaf.id, pageA.id], [branch.id, leaf.id], pageA.id],
    );
    expect(removedAuthority.rows[0]?.count).toBe('0');
  }, 120_000);
});
