import type { ShareEntityType, SharePermission } from '@metakip/shared';
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { consumeSelfLeave, markSelfLeave } from './leave-page';
import { removeFolderFromNavigationCache, removePageFromNavigationCache } from './navigationCache';
import { showSuccessToast } from './toast';

const API_BASE = '/api';

const invalidateRemovalQueries = (
  queryClient: QueryClient,
  entityType: ShareEntityType,
  includeTrash: boolean,
) => {
  queryClient.invalidateQueries({ queryKey: ['pageTree'] });
  queryClient.invalidateQueries({ queryKey: ['folderTree'] });
  queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
  queryClient.invalidateQueries({ queryKey: ['pages', 'recent'] });
  queryClient.invalidateQueries({ queryKey: ['favorites'] });
  if (!includeTrash) return;
  if (entityType === 'page') {
    queryClient.invalidateQueries({ queryKey: ['trashPages'] });
  } else {
    queryClient.invalidateQueries({ queryKey: ['trashFolders'] });
    queryClient.invalidateQueries({ queryKey: ['trashPages'] });
  }
};

const removeEntityFromNavigationCache = (
  queryClient: QueryClient,
  entityType: ShareEntityType,
  entityId: string,
) => {
  if (entityType === 'page') removePageFromNavigationCache(queryClient, entityId);
  else removeFolderFromNavigationCache(queryClient, entityId);
};

export type EntityShareSource = 'direct' | 'public' | 'workspace';

type EntityBase = {
  id: string;
  type: ShareEntityType;
  title: string;
  ownerId?: string | null | undefined;
  createdBy?: string | null | undefined;
  userPermission?: SharePermission | null | undefined;
  shareSource?: EntityShareSource | undefined;
};

type DeleteEntityOptions = {
  force?: boolean | undefined;
};

type UseEntityDeletionParams = {
  entityType: ShareEntityType;
  currentUserId?: string | undefined;
  onSuccess?: (() => void) | undefined;
};

export type DeleteEntityResult =
  | { deleted: true }
  | { requiresForce: true; childFolders: number; childPages: number; message: string };

type UseEntityDeletionReturn = {
  moveToTrash: (entity: EntityBase, options?: DeleteEntityOptions) => Promise<DeleteEntityResult>;
  removeFromView: (entity: EntityBase) => Promise<void>;
  isPending: boolean;
};

export async function leaveEntity(
  entityType: ShareEntityType,
  entityId: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/${entityType}s/${entityId}/leave`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ message: `Failed to remove ${entityType} from your view` }));
    throw new Error(error.message);
  }
  return res.json();
}

async function bulkLeaveEntities(entityType: ShareEntityType, entityIds: string[]): Promise<void> {
  const results = await Promise.allSettled(entityIds.map((id) => leaveEntity(entityType, id)));
  const failedCount = results.filter((result) => result.status === 'rejected').length;
  if (failedCount > 0) {
    const removedCount = results.length - failedCount;
    throw new Error(`${removedCount} removed, ${failedCount} failed`);
  }
}

export interface OwnedEntity {
  ownerId?: string | null | undefined;
  createdBy?: string | null | undefined;
}

export interface RenameableEntity extends OwnedEntity {
  type: ShareEntityType;
  userPermission?: SharePermission | null | undefined;
}

export function isOwnedByUser(entity: OwnedEntity, userId: string): boolean {
  return (entity.ownerId ?? entity.createdBy) === userId;
}

/** Pages can be renamed by editors; folders require administrative access. */
export function canRenameEntity(entity: RenameableEntity, userId?: string): boolean {
  if (!userId) return false;
  const isAdmin = isOwnedByUser(entity, userId) || entity.userPermission === 'admin';
  return entity.type === 'page' ? isAdmin || entity.userPermission === 'edit' : isAdmin;
}

/**
 * Moving an item to a workspace root makes its creator the effective owner.
 * Only offer that destination when doing so preserves the current owner.
 */
export function preservesEffectiveOwnerAtRoot(entity: OwnedEntity): boolean {
  return entity.ownerId != null && entity.createdBy === entity.ownerId;
}

/** Workspace inheritance wins for personal-removal UX because direct removal would retain access. */
export function resolveRemovalShareSource(
  source: EntityShareSource | undefined,
  hasWorkspaceAccess: boolean,
): EntityShareSource | undefined {
  return hasWorkspaceAccess ? 'workspace' : source;
}

export function useLeaveEntity(entityType: ShareEntityType) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entityId: string) => leaveEntity(entityType, entityId),
    onSuccess: () => {
      invalidateRemovalQueries(queryClient, entityType, false);
      showSuccessToast('Removed from your view');
    },
  });
}

export function useBulkLeaveEntities(entityType: ShareEntityType) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entityIds }: { entityIds: string[] }) =>
      bulkLeaveEntities(entityType, entityIds),
    onSuccess: (_result, { entityIds }) => {
      const suffix = entityIds.length === 1 ? 'item' : 'items';
      showSuccessToast(`Removed ${entityIds.length} ${suffix} from your view`);
    },
    onSettled: () => {
      invalidateRemovalQueries(queryClient, entityType, false);
    },
  });
}

async function deleteEntity(
  entityType: ShareEntityType,
  entityId: string,
  force?: boolean,
): Promise<DeleteEntityResult> {
  const url =
    entityType === 'folder' && force
      ? `${API_BASE}/${entityType}s/${entityId}?force=true`
      : `${API_BASE}/${entityType}s/${entityId}`;
  const res = await fetch(url, {
    method: 'DELETE',
  });
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (error) {
    throw new Error(`Invalid delete ${entityType} response`, { cause: error });
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Invalid delete ${entityType} response`);
  }
  const result = payload as {
    code?: unknown;
    deleted?: unknown;
    requiresForce?: unknown;
    childFolders?: unknown;
    childPages?: unknown;
    message?: unknown;
  };
  if (
    entityType === 'folder' &&
    res.status === 409 &&
    result.code === 'FOLDER_NOT_EMPTY' &&
    result.requiresForce === true &&
    typeof result.childFolders === 'number' &&
    typeof result.childPages === 'number'
  ) {
    return {
      requiresForce: true,
      childFolders: result.childFolders,
      childPages: result.childPages,
      message:
        'message' in result && typeof result.message === 'string'
          ? result.message
          : 'Folder is not empty',
    };
  }
  if (!res.ok) {
    throw new Error(
      typeof result.message === 'string' ? result.message : `Failed to delete ${entityType}`,
    );
  }
  if (result.deleted !== true) {
    throw new Error(`Invalid delete ${entityType} response`);
  }
  return { deleted: true };
}

export function useEntityDeletion({
  entityType,
  currentUserId,
  onSuccess,
}: UseEntityDeletionParams): UseEntityDeletionReturn {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: ({ entity, force }: { entity: EntityBase; force?: boolean | undefined }) =>
      deleteEntity(entityType, entity.id, force),
    onSuccess: (result, { entity }) => {
      if ('requiresForce' in result) return;
      removeEntityFromNavigationCache(queryClient, entityType, entity.id);
      invalidateRemovalQueries(queryClient, entityType, true);
      showSuccessToast(`Moved "${entity.title}" To Trash`);
      onSuccess?.();
    },
  });

  const leaveMutation = useMutation({
    mutationFn: (entity: EntityBase) => leaveEntity(entityType, entity.id),
    onSuccess: (_result, entity) => {
      removeEntityFromNavigationCache(queryClient, entityType, entity.id);
      invalidateRemovalQueries(queryClient, entityType, false);
      showSuccessToast(`“${entity.title}” removed from your view`);
      onSuccess?.();
    },
  });

  const moveToTrash = async (entity: EntityBase, options?: DeleteEntityOptions) => {
    const isOwned = currentUserId ? isOwnedByUser(entity, currentUserId) : false;
    const canDelete = isOwned || entity.userPermission === 'admin';
    if (!canDelete) throw new Error(`You cannot move this ${entity.type} to Trash`);
    if (entity.type === 'page') markSelfLeave(entity.id);
    try {
      return await deleteMutation.mutateAsync({ entity, force: options?.force });
    } catch (error) {
      if (entity.type === 'page') consumeSelfLeave(entity.id);
      throw error;
    }
  };

  const removeFromView = async (entity: EntityBase): Promise<void> => {
    const isOwned = currentUserId ? isOwnedByUser(entity, currentUserId) : false;
    if (isOwned) throw new Error(`You cannot remove your own ${entity.type} from your view`);
    if (entity.shareSource !== 'direct' && entity.shareSource !== 'public') {
      throw new Error(`This ${entity.type} inherits access and cannot be removed directly`);
    }
    if (entity.type === 'page') markSelfLeave(entity.id);
    try {
      await leaveMutation.mutateAsync(entity);
    } catch (error) {
      if (entity.type === 'page') consumeSelfLeave(entity.id);
      throw error;
    }
  };

  return {
    moveToTrash,
    removeFromView,
    isPending: deleteMutation.isPending || leaveMutation.isPending,
  };
}
