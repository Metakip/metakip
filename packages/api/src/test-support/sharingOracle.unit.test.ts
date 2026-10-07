import { describe, expect, it } from 'vitest';
import {
  decideSharingPermission,
  type OraclePermission,
  type OraclePublicPermission,
} from './sharingOracle';

const roles: readonly OraclePermission[] = [null, 'view', 'commenter', 'edit', 'admin'];
const workspaceRoles: readonly OraclePermission[] = [null, 'view', 'edit', 'admin'];
const publicPermissions: readonly OraclePublicPermission[] = [null, 'view', 'edit'];
const rank = (permission: OraclePermission) =>
  permission === 'admin'
    ? 4
    : permission === 'edit'
      ? 3
      : permission === 'commenter'
        ? 2
        : permission === 'view'
          ? 1
          : 0;

describe('independent sharing permission oracle', () => {
  it('exhausts the 108,000 depth-two permission cells', () => {
    let checked = 0;
    for (const workspace of workspaceRoles) {
      for (const targetGrant of roles) {
        for (const parentGrant of roles) {
          for (const grandparentGrant of roles) {
            for (const targetPublic of publicPermissions) {
              for (const parentPublic of publicPermissions) {
                for (const grandparentPublic of publicPermissions) {
                  for (let boundaryBits = 0; boundaryBits < 8; boundaryBits += 1) {
                    const decision = decideSharingPermission({
                      workspace,
                      nodes: [
                        {
                          grant: targetGrant,
                          publicAccess: targetPublic,
                          restricted: (boundaryBits & 1) !== 0,
                        },
                        {
                          grant: parentGrant,
                          publicAccess: parentPublic,
                          restricted: (boundaryBits & 2) !== 0,
                        },
                        {
                          grant: grandparentGrant,
                          publicAccess: grandparentPublic,
                          restricted: (boundaryBits & 4) !== 0,
                        },
                      ],
                    });

                    const highestActiveRank = decision.activeSources.reduce(
                      (highest, source) => Math.max(highest, rank(source.permission)),
                      0,
                    );
                    expect(rank(decision.permission)).toBe(highestActiveRank);
                    expect(decision.winningSources).toEqual(
                      decision.activeSources.filter(
                        (source) => rank(source.permission) === highestActiveRank,
                      ),
                    );
                    checked += 1;
                  }
                }
              }
            }
          }
        }
      }
    }

    expect(checked).toBe(108_000);
  }, 30_000);

  it('keeps target grants active through every boundary combination', () => {
    for (let boundaryBits = 0; boundaryBits < 8; boundaryBits += 1) {
      const decision = decideSharingPermission({
        workspace: 'admin',
        nodes: [
          { grant: 'edit', publicAccess: null, restricted: (boundaryBits & 1) !== 0 },
          { grant: null, publicAccess: null, restricted: (boundaryBits & 2) !== 0 },
          { grant: null, publicAccess: null, restricted: (boundaryBits & 4) !== 0 },
        ],
      });
      expect(decision.activeSources).toContainEqual({
        kind: 'grant',
        nodeIndex: 0,
        permission: 'edit',
      });
    }
  });

  it('activates the exact next-highest fallback when a winning source is removed', () => {
    const before = decideSharingPermission({
      workspace: 'view',
      nodes: [
        { grant: 'admin', publicAccess: null, restricted: false },
        { grant: 'edit', publicAccess: 'view', restricted: false },
      ],
    });
    const after = decideSharingPermission({
      workspace: 'view',
      nodes: [
        { grant: null, publicAccess: null, restricted: false },
        { grant: 'edit', publicAccess: 'view', restricted: false },
      ],
    });

    expect(before.permission).toBe('admin');
    expect(after.permission).toBe('edit');
  });
});
