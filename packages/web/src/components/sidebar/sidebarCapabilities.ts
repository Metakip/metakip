import type { SharePermission } from '@metakip/shared';
import { canRenameEntity } from '../../utils/entity-actions';

export type SidebarPlacement = 'owned' | 'workspace' | 'shared' | 'alias';

type SidebarCapabilityInput = {
  entityType: 'page' | 'folder';
  ownerId?: string | null | undefined;
  createdBy?: string | null | undefined;
  userPermission?: SharePermission | null | undefined;
  currentUserId?: string | undefined;
  placement: SidebarPlacement;
  sourceIsAdmin?: boolean;
};

export type SidebarCapabilities = {
  canRename: boolean;
  canMove: boolean;
  canCreateChild: boolean;
};

export function deriveSidebarCapabilities({
  entityType,
  ownerId,
  createdBy,
  userPermission,
  currentUserId,
  placement,
  sourceIsAdmin = false,
}: SidebarCapabilityInput): SidebarCapabilities {
  const isAdmin = userPermission === 'admin';
  const canMove =
    placement === 'owned'
      ? true
      : placement === 'alias'
        ? ownerId === currentUserId
        : isAdmin && sourceIsAdmin;
  const canCreateChild =
    entityType === 'folder' && (userPermission === 'edit' || userPermission === 'admin');
  const canRename = canRenameEntity(
    { type: entityType, ownerId, createdBy, userPermission },
    currentUserId,
  );

  return { canRename, canMove, canCreateChild };
}
