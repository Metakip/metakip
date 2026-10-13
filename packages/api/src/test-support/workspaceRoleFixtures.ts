import type { WorkspaceRole } from '@metakip/shared';
import type { OraclePermission } from './sharingOracle';

export const workspacePermissions: readonly OraclePermission[] = [
  null,
  'view',
  'commenter',
  'edit',
  'admin',
];

const rolesByPermission = {
  view: 'viewer',
  commenter: 'commenter',
  edit: 'editor',
  admin: 'admin',
} as const satisfies Record<Exclude<OraclePermission, null>, WorkspaceRole>;

export const workspaceRoleForPermission = (
  permission: Exclude<OraclePermission, null>,
): WorkspaceRole => rolesByPermission[permission];
