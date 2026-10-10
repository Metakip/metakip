import type { ShareEntityType, SharePermission, WorkspaceRole } from './access.js';

export type InvitationTargetType = 'workspace' | ShareEntityType;
export type InvitationLifecycleStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'superseded';
export type InvitationClaimStatus = InvitationLifecycleStatus | 'expired';
export type InvitationDeliveryStatus = 'pending' | 'sent' | 'failed';

interface PendingInvitationBase {
  id: string;
  targetId: string;
  email: string;
  canManage: boolean;
  deliveryStatus: InvitationDeliveryStatus;
  expiresAt: string;
  createdAt: string;
}

export type PendingWorkspaceInvitation = PendingInvitationBase & {
  targetType: 'workspace';
  permission: WorkspaceRole;
};

export type PendingEntityInvitation = PendingInvitationBase & {
  targetType: ShareEntityType;
  permission: SharePermission;
};

export type PendingInvitation = PendingWorkspaceInvitation | PendingEntityInvitation;

interface InvitationClaimBase {
  status: InvitationClaimStatus;
  targetTitle: string;
  inviterName: string;
  email: string;
}

export type InvitationClaim =
  | (InvitationClaimBase & { targetType: 'workspace'; permission: WorkspaceRole })
  | (InvitationClaimBase & { targetType: ShareEntityType; permission: SharePermission });

/**
 * Discriminated action for a share-related realtime event.
 * - `grant`: a new account grant was created
 * - `update`: an existing account or public permission changed
 * - `revoke`: a share was deleted or set to private
 * - `recompute`: permissions changed indirectly and must be reloaded from the DB
 */
export type ShareEventAction = 'grant' | 'update' | 'revoke' | 'recompute';
export type StatelessShareEventAction = Exclude<ShareEventAction, 'recompute'>;

/**
 * Canonical payload sent over PostgreSQL LISTEN/NOTIFY from the API server
 * to the collab (WebSocket) server.
 *
 * `targetUserId` determines which connections are affected for grant/update/revoke events:
 * - `undefined` → affects every connection (public access changes)
 * - a user ID  → affects that specific authenticated account grant
 *
 * `recompute` ignores `targetUserId` and asks the collab server to reload effective
 * permissions for every active connection on the affected page(s).
 *
 * `message` is a human-readable description of what happened, intended for
 * display as a toast on the client. The collab server passes it through
 * to the WebSocket stateless message unchanged.
 */
export interface ShareEventPayload {
  type: 'share_event';
  action: ShareEventAction;
  entityType: ShareEntityType;
  entityId: string;
  permission?: SharePermission;
  targetUserId?: string;
  /** Additional signed-in users whose metadata queries must refresh. */
  metaUserIds?: string[];
  /** Refresh metadata/access versions without revalidating active page connections. */
  metaOnly?: boolean;
  /** Human-readable toast message for the affected user(s). */
  message?: string;
}

/** Best-effort realtime signal that a direct account grant was created. */
export interface GrantReceivedNotificationPayload {
  type: 'grant_received';
  entityType: ShareEntityType;
  entityId: string;
  entityTitle: string;
  sharedByName: string;
  targetUserId: string;
  permission: SharePermission;
  message?: string;
}

/** Canonical workspace-membership invalidation sent from API to collaboration. */
export interface WorkspaceNotificationPayload {
  type: 'workspace_event';
  action: 'member_added' | 'member_removed' | 'role_changed';
  ownerId: string;
  memberId: string;
  message?: string;
}

export type AccessNotificationPayload =
  | ShareEventPayload
  | GrantReceivedNotificationPayload
  | WorkspaceNotificationPayload;

/** Best-effort direct-grant signal sent from collaboration to the browser. */
export interface GrantReceivedMessage {
  type: 'grant_received';
  entityType: ShareEntityType;
  entityId: string;
  entityTitle: string;
  sharedByName: string;
  message?: string;
  refreshViaAccessVersion?: true;
}

/** Browser compatibility signal for a canonical workspace metadata refresh. */
export interface WorkspaceMembershipMessage {
  type: 'workspace_membership_event';
  action: WorkspaceNotificationPayload['action'];
  ownerId: string;
  refreshViaAccessVersion?: true;
}

export interface ShareAccessMessage {
  type: 'share_access_event';
  action: ShareEventAction;
  entityType: ShareEntityType;
  entityId: string;
}

export interface FolderDeletedMessage {
  type: 'entity_deleted';
  entityType: 'folder';
  entityId: string;
}

export type PageMetaStatelessMessage =
  | WorkspaceMembershipMessage
  | FolderDeletedMessage
  | ShareAccessMessage
  | GrantReceivedMessage;

/**
 * Stateless message sent over WebSocket from the collab server to affected
 * client connections. Clients use this to update their readOnly state,
 * show toasts, or redirect — no permission logic lives on the client.
 *
 * The permission value is sent as-is (including `'admin'`). Clients are
 * responsible for mapping `'admin'` to `'edit'` for read-only state but
 * may use the raw value for display purposes (e.g. toast messages).
 */
export interface StatelessShareMessage {
  type: 'share_event';
  action: StatelessShareEventAction;
  permission?: SharePermission;
  message?: string;
}

/**
 * Authoritative effective permission for a collaboration connection.
 *
 * `accessRevision` is a durable, transactionally updated access-state revision
 * encoded as a decimal string. Clients compare it as an integer and must
 * ignore older snapshots.
 * Unlike `share_event`, this message is state rather than a toast/invalidation.
 */
export interface PermissionSnapshotMessage {
  type: 'permission_snapshot';
  permission: SharePermission | null;
  accessRevision: string;
}

const permissionRank = (permission: SharePermission | null): number => {
  if (permission === 'admin') return 4;
  if (permission === 'edit') return 3;
  if (permission === 'commenter') return 2;
  if (permission === 'view') return 1;
  return 0;
};

/**
 * At an equal revision, only the same permission or a downgrade is safe. An
 * upgrade requires a newer revision from an explicit access mutation.
 */
export function shouldApplyPermissionSnapshot(
  current: Pick<PermissionSnapshotMessage, 'permission' | 'accessRevision'> | null,
  incoming: Pick<PermissionSnapshotMessage, 'permission' | 'accessRevision'>,
): boolean {
  if (!current) return true;
  const currentRevision = BigInt(current.accessRevision);
  const incomingRevision = BigInt(incoming.accessRevision);
  if (incomingRevision !== currentRevision) return incomingRevision > currentRevision;
  return permissionRank(incoming.permission) <= permissionRank(current.permission);
}

export interface EntityDeletedMessage {
  type: 'entity_deleted';
  entityType: ShareEntityType;
  entityId: string;
  pageId?: string;
}
