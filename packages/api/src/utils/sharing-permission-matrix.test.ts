import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import {
  decideSharingPermission,
  type OraclePermission,
  type OraclePublicPermission,
} from '../test-support/sharingOracle';

const roles: readonly OraclePermission[] = [null, 'view', 'commenter', 'edit', 'admin'];
const workspaceRoles: readonly OraclePermission[] = [null, 'view', 'edit', 'admin'];
const publicPermissions: readonly OraclePublicPermission[] = [null, 'view', 'edit'];

type RoleVector = {
  index: number;
  userId: string;
  workspace: OraclePermission;
  target: OraclePermission;
  parent: OraclePermission;
  grandparent: OraclePermission;
};

type Structure = {
  index: number;
  ownerId: string;
  grandparentId: string;
  parentId: string;
  targetFolderId: string;
  pageId: string;
  targetPublic: OraclePublicPermission;
  parentPublic: OraclePublicPermission;
  grandparentPublic: OraclePublicPermission;
  boundaryBits: number;
};

type ShareSeed = {
  entityType: 'page' | 'folder';
  entityId: string;
  ownerId: string;
  recipientId: string;
  permission: Exclude<OraclePermission, null>;
};

const inChunks = <T>(values: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

async function insertShares(shares: readonly ShareSeed[]): Promise<void> {
  for (const batch of inChunks(shares, 5_000)) {
    await query(
      `
        INSERT INTO shares (
          entity_type, entity_id, shared_by, recipient_user_id, permission
        )
        SELECT *
        FROM UNNEST(
          $1::text[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[]
        )
      `,
      [
        batch.map((share) => share.entityType),
        batch.map((share) => share.entityId),
        batch.map((share) => share.ownerId),
        batch.map((share) => share.recipientId),
        batch.map((share) => share.permission),
      ],
    );
  }
}

describe('sharing SQL permission matrix', () => {
  it('matches the independent oracle for all 216,000 depth-two page and folder cells', async () => {
    const structures: Structure[] = [];
    let structureIndex = 0;
    for (const targetPublic of publicPermissions) {
      for (const parentPublic of publicPermissions) {
        for (const grandparentPublic of publicPermissions) {
          for (let boundaryBits = 0; boundaryBits < 8; boundaryBits += 1) {
            structures.push({
              index: structureIndex,
              ownerId: crypto.randomUUID(),
              grandparentId: crypto.randomUUID(),
              parentId: crypto.randomUUID(),
              targetFolderId: crypto.randomUUID(),
              pageId: crypto.randomUUID(),
              targetPublic,
              parentPublic,
              grandparentPublic,
              boundaryBits,
            });
            structureIndex += 1;
          }
        }
      }
    }

    const roleVectors: RoleVector[] = [];
    for (const workspace of workspaceRoles) {
      for (const target of roles) {
        for (const parent of roles) {
          for (const grandparent of roles) {
            roleVectors.push({
              index: roleVectors.length,
              userId: crypto.randomUUID(),
              workspace,
              target,
              parent,
              grandparent,
            });
          }
        }
      }
    }

    const userIds = [
      ...structures.map((structure) => structure.ownerId),
      ...roleVectors.map((vector) => vector.userId),
    ];
    const userNames = [
      ...structures.map((structure) => `matrix-owner-${structure.index}`),
      ...roleVectors.map((vector) => `matrix-recipient-${vector.index}`),
    ];
    const userEmails = [
      ...structures.map((structure) => `matrix-owner-${structure.index}@example.com`),
      ...roleVectors.map((vector) => `matrix-recipient-${vector.index}@example.com`),
    ];
    await query(
      `INSERT INTO users (id, name, email)
         SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[])`,
      [userIds, userNames, userEmails],
    );

    await query(
      `
          INSERT INTO folders (
            id, parent_id, name, created_by, inheritance_policy, public_permission
          )
          SELECT *
          FROM UNNEST(
            $1::uuid[], $2::uuid[], $3::text[], $4::uuid[], $5::text[], $6::text[]
          )
        `,
      [
        structures.map((structure) => structure.grandparentId),
        structures.map(() => null),
        structures.map((structure) => `matrix-grandparent-${structure.index}`),
        structures.map((structure) => structure.ownerId),
        structures.map((structure) =>
          (structure.boundaryBits & 4) !== 0 ? 'restricted' : 'inherit',
        ),
        structures.map((structure) => structure.grandparentPublic),
      ],
    );
    await query(
      `
          INSERT INTO folders (
            id, parent_id, name, created_by, inheritance_policy, public_permission
          )
          SELECT *
          FROM UNNEST(
            $1::uuid[], $2::uuid[], $3::text[], $4::uuid[], $5::text[], $6::text[]
          )
        `,
      [
        structures.map((structure) => structure.parentId),
        structures.map((structure) => structure.grandparentId),
        structures.map((structure) => `matrix-parent-${structure.index}`),
        structures.map((structure) => structure.ownerId),
        structures.map((structure) =>
          (structure.boundaryBits & 2) !== 0 ? 'restricted' : 'inherit',
        ),
        structures.map((structure) => structure.parentPublic),
      ],
    );
    await query(
      `
          INSERT INTO pages (
            id, parent_id, title, created_by, inheritance_policy, public_permission
          )
          SELECT *
          FROM UNNEST(
            $1::uuid[], $2::uuid[], $3::text[], $4::uuid[], $5::text[], $6::text[]
          )
        `,
      [
        structures.map((structure) => structure.pageId),
        structures.map((structure) => structure.parentId),
        structures.map((structure) => `matrix-page-${structure.index}`),
        structures.map((structure) => structure.ownerId),
        structures.map((structure) =>
          (structure.boundaryBits & 1) !== 0 ? 'restricted' : 'inherit',
        ),
        structures.map((structure) => structure.targetPublic),
      ],
    );
    await query(
      `
          INSERT INTO folders (
            id, parent_id, name, created_by, inheritance_policy, public_permission
          )
          SELECT *
          FROM UNNEST(
            $1::uuid[], $2::uuid[], $3::text[], $4::uuid[], $5::text[], $6::text[]
          )
        `,
      [
        structures.map((structure) => structure.targetFolderId),
        structures.map((structure) => structure.parentId),
        structures.map((structure) => `matrix-target-folder-${structure.index}`),
        structures.map((structure) => structure.ownerId),
        structures.map((structure) =>
          (structure.boundaryBits & 1) !== 0 ? 'restricted' : 'inherit',
        ),
        structures.map((structure) => structure.targetPublic),
      ],
    );

    const memberships = structures.flatMap((structure) =>
      roleVectors
        .filter((vector) => vector.workspace !== null)
        .map((vector) => ({
          ownerId: structure.ownerId,
          memberId: vector.userId,
          role:
            vector.workspace === 'view'
              ? 'viewer'
              : vector.workspace === 'edit'
                ? 'editor'
                : 'admin',
        })),
    );
    for (const batch of inChunks(memberships, 10_000)) {
      await query(
        `
            INSERT INTO workspace_members (workspace_owner_id, member_id, role)
            SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::text[])
          `,
        [
          batch.map((membership) => membership.ownerId),
          batch.map((membership) => membership.memberId),
          batch.map((membership) => membership.role),
        ],
      );
    }

    const shares: ShareSeed[] = [];
    for (const structure of structures) {
      for (const vector of roleVectors) {
        if (vector.target !== null) {
          shares.push({
            entityType: 'page',
            entityId: structure.pageId,
            ownerId: structure.ownerId,
            recipientId: vector.userId,
            permission: vector.target,
          });
          shares.push({
            entityType: 'folder',
            entityId: structure.targetFolderId,
            ownerId: structure.ownerId,
            recipientId: vector.userId,
            permission: vector.target,
          });
        }
        if (vector.parent !== null) {
          shares.push({
            entityType: 'folder',
            entityId: structure.parentId,
            ownerId: structure.ownerId,
            recipientId: vector.userId,
            permission: vector.parent,
          });
        }
        if (vector.grandparent !== null) {
          shares.push({
            entityType: 'folder',
            entityId: structure.grandparentId,
            ownerId: structure.ownerId,
            recipientId: vector.userId,
            permission: vector.grandparent,
          });
        }
      }
    }
    await insertShares(shares);
    // Bulk fixtures bypass normal autovacuum cadence. Fresh statistics keep
    // the 55k canonical-function probes on indexed plans in CI as well as
    // developer machines.
    await query('ANALYZE users, folders, folder_closure, pages, shares, workspace_members');

    type MatrixRow = {
      structure_index: number;
      role_index: number;
      permission: OraclePermission;
    };
    const shardIndexes = [0, 1, 2, 3] as const;
    // The API pool has five connections. Run the two four-shard sweeps in
    // sequence so the fixture/runner connection cannot be starved by eight
    // simultaneous matrix queries.
    const pageBatches = await Promise.all(
      shardIndexes.map((shardIndex) =>
        query<MatrixRow>(
          `
                SELECT REPLACE(p.title, 'matrix-page-', '')::integer AS structure_index,
                       REPLACE(u.name, 'matrix-recipient-', '')::integer AS role_index,
                       access.permission
                FROM pages p
                JOIN users u ON u.name LIKE 'matrix-recipient-%'
                JOIN LATERAL get_effective_page_permission(p.id, u.id) access ON true
                WHERE p.title LIKE 'matrix-page-%'
                  AND MOD(REPLACE(p.title, 'matrix-page-', '')::integer, 4) = $1
                ORDER BY structure_index, role_index
              `,
          [shardIndex],
        ),
      ),
    );
    const folderBatches = await Promise.all(
      shardIndexes.map((shardIndex) =>
        query<MatrixRow>(
          `
                SELECT REPLACE(f.name, 'matrix-target-folder-', '')::integer AS structure_index,
                       REPLACE(u.name, 'matrix-recipient-', '')::integer AS role_index,
                       access.permission
                FROM folders f
                JOIN users u ON u.name LIKE 'matrix-recipient-%'
                JOIN LATERAL get_effective_folder_permission(f.id, u.id) access ON true
                WHERE f.name LIKE 'matrix-target-folder-%'
                  AND MOD(REPLACE(f.name, 'matrix-target-folder-', '')::integer, 4) = $1
                ORDER BY structure_index, role_index
              `,
          [shardIndex],
        ),
      ),
    );
    const actual = pageBatches.flatMap((batch) => batch.rows);
    const actualFolders = folderBatches.flatMap((batch) => batch.rows);

    expect(actual).toHaveLength(108_000);
    for (const row of actual) {
      const structure = structures[row.structure_index];
      const vector = roleVectors[row.role_index];
      if (!structure || !vector) {
        throw new Error(`Invalid matrix coordinates ${row.structure_index}/${row.role_index}`);
      }
      const expected = decideSharingPermission({
        workspace: vector.workspace,
        nodes: [
          {
            grant: vector.target,
            publicAccess: structure.targetPublic,
            restricted: (structure.boundaryBits & 1) !== 0,
          },
          {
            grant: vector.parent,
            publicAccess: structure.parentPublic,
            restricted: (structure.boundaryBits & 2) !== 0,
          },
          {
            grant: vector.grandparent,
            publicAccess: structure.grandparentPublic,
            restricted: (structure.boundaryBits & 4) !== 0,
          },
        ],
      });
      expect(row.permission, `matrix cell ${row.structure_index}/${row.role_index}`).toBe(
        expected.permission,
      );
    }

    expect(actualFolders).toHaveLength(108_000);
    for (const row of actualFolders) {
      const structure = structures[row.structure_index];
      const vector = roleVectors[row.role_index];
      if (!structure || !vector) {
        throw new Error(
          `Invalid folder matrix coordinates ${row.structure_index}/${row.role_index}`,
        );
      }
      const expected = decideSharingPermission({
        workspace: vector.workspace,
        nodes: [
          {
            grant: vector.target,
            publicAccess: structure.targetPublic,
            restricted: (structure.boundaryBits & 1) !== 0,
          },
          {
            grant: vector.parent,
            publicAccess: structure.parentPublic,
            restricted: (structure.boundaryBits & 2) !== 0,
          },
          {
            grant: vector.grandparent,
            publicAccess: structure.grandparentPublic,
            restricted: (structure.boundaryBits & 4) !== 0,
          },
        ],
      });
      expect(row.permission, `folder matrix cell ${row.structure_index}/${row.role_index}`).toBe(
        expected.permission,
      );
    }
  }, 600_000);
});
