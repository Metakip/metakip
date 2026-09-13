import type { Document } from '@hocuspocus/server';
import type {
  PermissionSnapshotMessage,
  SharePermission,
  StatelessShareMessage,
} from '@metakip/shared';
import { COLLAB_TERMINAL_REASONS, shouldApplyPermissionSnapshot } from '@metakip/shared';

export type PermissionConnection = ReturnType<Document['getConnections']>[number];

export type PermissionState = {
  permission: SharePermission | null;
  accessRevision: string;
};

export type GrantedPermissionState = {
  permission: SharePermission;
  accessRevision: string;
};

export type PermissionContext = PermissionState;

export type PermissionTransitionResult = 'ignored' | 'unchanged' | 'updated' | 'revoked';

export function getCurrentPermission(context: PermissionContext): SharePermission | null {
  return context.permission;
}

export function applyPermissionState(
  connection: Pick<PermissionConnection, 'readOnly'> | undefined,
  context: PermissionContext,
  incoming: PermissionState,
): { applied: boolean; previousPermission: SharePermission | null; previousReadOnly: boolean } {
  const previousPermission = getCurrentPermission(context);
  const previousReadOnly = connection?.readOnly ?? true;
  const current = { permission: previousPermission, accessRevision: context.accessRevision };
  if (!shouldApplyPermissionSnapshot(current, incoming)) {
    return { applied: false, previousPermission, previousReadOnly };
  }

  context.permission = incoming.permission;
  context.accessRevision = incoming.accessRevision;
  if (connection) {
    connection.readOnly = incoming.permission === 'view' || incoming.permission === null;
  }
  return { applied: true, previousPermission, previousReadOnly };
}

export function sendPermissionSnapshot(
  connection: Pick<PermissionConnection, 'sendStateless'>,
  permission: SharePermission | null,
  accessRevision: string,
): void {
  connection.sendStateless(
    JSON.stringify({
      type: 'permission_snapshot',
      permission,
      accessRevision,
    } satisfies PermissionSnapshotMessage),
  );
}

export function applyPermissionSnapshot(
  connection: Pick<PermissionConnection, 'readOnly' | 'sendStateless'>,
  context: PermissionContext,
  incoming: PermissionState,
): { applied: boolean; previousPermission: SharePermission | null; previousReadOnly: boolean } {
  const result = applyPermissionState(connection, context, incoming);
  if (result.applied) {
    sendPermissionSnapshot(connection, incoming.permission, incoming.accessRevision);
  }
  return result;
}

export function applyPagePermissionTransition(
  connection: PermissionConnection,
  context: PermissionContext,
  incoming: PermissionState,
  message?: string,
): PermissionTransitionResult {
  const snapshot = applyPermissionSnapshot(connection, context, incoming);
  if (!snapshot.applied) return 'ignored';

  if (incoming.permission === null) {
    connection.sendStateless(
      JSON.stringify({
        type: 'share_event',
        action: 'revoke',
        ...(message !== undefined && { message }),
      } satisfies StatelessShareMessage),
    );
    connection.close({ code: 4401, reason: COLLAB_TERMINAL_REASONS.ACCESS_REVOKED });
    return 'revoked';
  }

  const unchanged =
    snapshot.previousPermission === incoming.permission &&
    snapshot.previousReadOnly === connection.readOnly;
  if (unchanged && message === undefined) return 'unchanged';

  connection.sendStateless(
    JSON.stringify({
      type: 'share_event',
      action: 'update',
      permission: incoming.permission,
      ...(message !== undefined && { message }),
    } satisfies StatelessShareMessage),
  );
  return unchanged ? 'unchanged' : 'updated';
}
