import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';
import { executeQuery } from '../db/query';
import { testQuery as query } from '../db/testQuery';
import {
  decideSharingPermission,
  type OraclePermission,
  type OraclePublicPermission,
} from '../test-support/sharingOracle';
import { createTestFolder, createTestPage, createTestUser } from '../test-utils';

const roles: readonly OraclePermission[] = [null, 'view', 'commenter', 'edit', 'admin'];
const workspaceRoles: readonly OraclePermission[] = [null, 'view', 'edit', 'admin'];
const publicPermissions: readonly OraclePublicPermission[] = [null, 'view', 'edit'];

type MutableWorld = {
  workspace: OraclePermission;
  grants: [OraclePermission, OraclePermission, OraclePermission];
  publicAccess: [OraclePublicPermission, OraclePublicPermission, OraclePublicPermission];
  restricted: [boolean, boolean, boolean];
};

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

describe('seeded sharing state machine', () => {
  it('matches the oracle after every mutation in reproducible histories', async () => {
    const seeds = [0x107, 0x5eed, 0xc0ffee, 0xdecafbad];

    for (const seed of seeds) {
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const grandparent = await createTestFolder(owner.id, { name: `Grandparent ${seed}` });
      const parent = await createTestFolder(owner.id, {
        name: `Parent ${seed}`,
        parentId: grandparent.id,
      });
      const page = await createTestPage(owner.id, {
        title: `State machine ${seed}`,
        parentId: parent.id,
      });
      const entityIds = [page.id, parent.id, grandparent.id] as const;
      const entityTypes = ['page', 'folder', 'folder'] as const;
      const world: MutableWorld = {
        workspace: null,
        grants: [null, null, null],
        publicAccess: [null, null, null],
        restricted: [false, false, false],
      };
      const trace: string[] = [];
      const random = seededRandom(seed);

      for (let step = 0; step < 150; step += 1) {
        const axis = Math.floor(random() * 10);
        if (axis === 0) {
          const permission = workspaceRoles[Math.floor(random() * workspaceRoles.length)] ?? null;
          world.workspace = permission;
          await query(
            'DELETE FROM workspace_members WHERE workspace_owner_id = $1 AND member_id = $2',
            [owner.id, recipient.id],
          );
          if (permission !== null) {
            const role =
              permission === 'view' ? 'viewer' : permission === 'edit' ? 'editor' : 'admin';
            await query(
              'INSERT INTO workspace_members (workspace_owner_id, member_id, role) VALUES ($1, $2, $3)',
              [owner.id, recipient.id, role],
            );
          }
          trace.push(`workspace=${permission ?? 'none'}`);
        } else if (axis >= 1 && axis <= 3) {
          const nodeIndex = axis - 1;
          const permission = roles[Math.floor(random() * roles.length)] ?? null;
          world.grants[nodeIndex] = permission;
          await query(
            `DELETE FROM shares
             WHERE entity_type = $1 AND entity_id = $2 AND recipient_user_id = $3`,
            [entityTypes[nodeIndex], entityIds[nodeIndex], recipient.id],
          );
          if (permission !== null) {
            await query(
              `INSERT INTO shares (
                 entity_type, entity_id, shared_by, recipient_user_id, permission
               ) VALUES ($1, $2, $3, $4, $5)`,
              [entityTypes[nodeIndex], entityIds[nodeIndex], owner.id, recipient.id, permission],
            );
          }
          trace.push(`grant[${nodeIndex}]=${permission ?? 'none'}`);
        } else if (axis >= 4 && axis <= 6) {
          const nodeIndex = axis - 4;
          const permission =
            publicPermissions[Math.floor(random() * publicPermissions.length)] ?? null;
          world.publicAccess[nodeIndex] = permission;
          await db.transaction(async (tx) => {
            await executeQuery(
              tx,
              entityTypes[nodeIndex] === 'page'
                ? sql`UPDATE pages SET public_permission = ${permission} WHERE id = ${entityIds[nodeIndex]}`
                : sql`UPDATE folders SET public_permission = ${permission} WHERE id = ${entityIds[nodeIndex]}`,
            );
          });
          trace.push(`publicAccess[${nodeIndex}]=${permission ?? 'none'}`);
        } else {
          const nodeIndex = axis - 7;
          const restricted = random() >= 0.5;
          world.restricted[nodeIndex] = restricted;
          await query(
            entityTypes[nodeIndex] === 'page'
              ? 'UPDATE pages SET inheritance_policy = $1 WHERE id = $2'
              : 'UPDATE folders SET inheritance_policy = $1 WHERE id = $2',
            [restricted ? 'restricted' : 'inherit', entityIds[nodeIndex]],
          );
          trace.push(`restricted[${nodeIndex}]=${restricted}`);
        }

        const expected = decideSharingPermission({
          workspace: world.workspace,
          nodes: world.grants.map((grant, nodeIndex) => ({
            grant,
            publicAccess: world.publicAccess[nodeIndex] ?? null,
            restricted: world.restricted[nodeIndex] ?? false,
          })),
        });
        const actual = await query<{ permission: OraclePermission }>(
          'SELECT permission FROM get_effective_page_permission($1, $2)',
          [page.id, recipient.id],
        );
        expect(
          actual.rows[0]?.permission ?? null,
          `seed=${seed} step=${step} trace=${trace.slice(-12).join(' -> ')}`,
        ).toBe(expected.permission);
      }
    }
  });
});
