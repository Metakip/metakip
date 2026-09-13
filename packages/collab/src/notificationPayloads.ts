import type {
  GrantReceivedNotificationPayload,
  ShareEventPayload,
  SharePermission,
  WorkspaceNotificationPayload,
} from '@metakip/shared';
import { isUuid } from './utils';

export type GrantReceivedPayload = GrantReceivedNotificationPayload;
export type WorkspaceEventPayload = WorkspaceNotificationPayload;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPermission(value: unknown): value is SharePermission {
  return value === 'view' || value === 'edit' || value === 'admin';
}

function hasOptionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function parseNotificationJson(payload: string | undefined): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payload ?? '{}');
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseGrantReceivedPayload(
  value: Record<string, unknown>,
): GrantReceivedPayload | null {
  if (
    value.type !== 'grant_received' ||
    (value.entityType !== 'page' && value.entityType !== 'folder') ||
    !isUuid(value.entityId) ||
    typeof value.entityTitle !== 'string' ||
    typeof value.sharedByName !== 'string' ||
    !isUuid(value.targetUserId) ||
    !isPermission(value.permission) ||
    !hasOptionalString(value, 'message')
  ) {
    return null;
  }
  return {
    type: 'grant_received',
    entityType: value.entityType,
    entityId: value.entityId,
    entityTitle: value.entityTitle,
    sharedByName: value.sharedByName,
    targetUserId: value.targetUserId,
    permission: value.permission,
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
  };
}

export function parseShareEventPayload(value: Record<string, unknown>): ShareEventPayload | null {
  if (
    value.type !== 'share_event' ||
    (value.action !== 'grant' &&
      value.action !== 'update' &&
      value.action !== 'revoke' &&
      value.action !== 'recompute') ||
    (value.entityType !== 'page' && value.entityType !== 'folder') ||
    !isUuid(value.entityId) ||
    (value.permission !== undefined && !isPermission(value.permission)) ||
    !hasOptionalString(value, 'targetUserId') ||
    !hasOptionalString(value, 'message') ||
    (value.metaOnly !== undefined && typeof value.metaOnly !== 'boolean') ||
    (value.targetUserId !== undefined && !isUuid(value.targetUserId)) ||
    (value.metaUserIds !== undefined &&
      (!isStringArray(value.metaUserIds) || !value.metaUserIds.every(isUuid)))
  ) {
    return null;
  }
  return {
    type: 'share_event',
    action: value.action,
    entityType: value.entityType,
    entityId: value.entityId,
    ...(isPermission(value.permission) ? { permission: value.permission } : {}),
    ...(typeof value.targetUserId === 'string' ? { targetUserId: value.targetUserId } : {}),
    ...(isStringArray(value.metaUserIds) ? { metaUserIds: value.metaUserIds } : {}),
    ...(typeof value.metaOnly === 'boolean' ? { metaOnly: value.metaOnly } : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
  };
}

export function parseWorkspaceEventPayload(
  value: Record<string, unknown>,
): WorkspaceEventPayload | null {
  if (
    value.type !== 'workspace_event' ||
    (value.action !== 'member_added' &&
      value.action !== 'member_removed' &&
      value.action !== 'role_changed') ||
    !isUuid(value.ownerId) ||
    !isUuid(value.memberId) ||
    !hasOptionalString(value, 'message')
  ) {
    return null;
  }
  return {
    type: 'workspace_event',
    action: value.action,
    ownerId: value.ownerId,
    memberId: value.memberId,
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
  };
}
