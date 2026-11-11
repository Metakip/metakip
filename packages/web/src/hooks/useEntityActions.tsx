import type { ShareEntityType, SharePermission } from '@metakip/shared';
import { Copy, Download, Edit2, EyeOff, FolderInput, Share, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ShareDialog } from '../components/editor/ShareDialog';
import { MoveDialog } from '../components/workspace/MoveDialog';
import { useClipboard } from '../contexts/ClipboardContext';
import { useIdentityLifecycle } from '../contexts/IdentityLifecycleContext';
import { useShareContext } from '../contexts/ShareContext';
import {
  canAdministerEntity,
  canRemoveEntityFromView,
  canRenameEntity,
  type EntityShareSource,
  isOwnedByUser,
  preservesEffectiveOwnerAtRoot,
  useEntityDeletion,
} from '../utils/entity-actions';
import { showErrorToast, showSuccessToast } from '../utils/toast';
import { useBulkMoveFolders, useBulkMovePages } from './use-bulk-actions';
import { useToggleFavorite } from './use-favorites';
import { useFolderTree } from './use-folders';
import { useWorkspaceMemberships } from './use-workspace';
import { useAuth } from './useAuth';

export type EntityActionOptions = {
  item: {
    id: string;
    type: ShareEntityType;
    title: string;
    icon?: string | null;
    ownerId?: string | null | undefined;
    createdBy?: string | null | undefined;
    userPermission?: SharePermission | null | undefined;
    shareSource?: EntityShareSource | undefined;
    canMove?: boolean | undefined;
  };
  isFavorite?: boolean;
  onRename?: () => void;
  onDeleted?: () => void;
  onCopy?: () => void;
};

export function useEntityActions({
  item,
  isFavorite = false,
  onRename,
  onDeleted,
  onCopy,
}: EntityActionOptions) {
  const identityLifecycle = useIdentityLifecycle();
  const clipboard = useClipboard();
  const { isAnonymous } = useShareContext();
  const { data: session } = useAuth();
  const currentUserId = session?.user?.id;
  const toggleFavoriteMutation = useToggleFavorite();
  const bulkMovePagesMutation = useBulkMovePages();
  const bulkMoveFoldersMutation = useBulkMoveFolders();
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  // Sidebar rows share these caches; don't add requests or build dialogs for idle menus.
  const foldersQuery = useFolderTree({ enabled: !isAnonymous && moveDialogOpen });
  const { data: workspaceMemberships } = useWorkspaceMemberships({
    enabled: !isAnonymous && moveDialogOpen,
  });
  const {
    moveToTrash,
    removeFromView,
    isPending: isRemovalPending,
  } = useEntityDeletion({
    entityType: item.type,
    currentUserId,
    onSuccess: onDeleted,
  });

  const [showShareDialog, setShowShareDialog] = useState(false);
  const [pendingRemovalAction, setPendingRemovalAction] = useState<'trash' | 'remove' | null>(null);

  const isOwned = currentUserId !== undefined && isOwnedByUser(item, currentUserId);
  const isAdmin = canAdministerEntity(item, currentUserId);
  const canRename = canRenameEntity(item, currentUserId);
  const canRemoveFromView = !isAnonymous && canRemoveEntityFromView(item, currentUserId);
  const canMove = item.canMove ?? isAdmin;
  const hasWorkspaceRootAccess =
    isOwned ||
    workspaceMemberships?.some(
      (membership) => membership.ownerId === item.ownerId && membership.role === 'admin',
    ) === true;
  const allowMoveToRoot = hasWorkspaceRootAccess && preservesEffectiveOwnerAtRoot(item);

  const handleCopy = () => {
    clipboard.copy([{ id: item.id, type: item.type }]);
    showSuccessToast('Copied to clipboard');
  };

  const handleConfirmMove = (targetFolderId: string | null) => {
    const onSuccess = () => {
      setMoveDialogOpen(false);
    };
    if (item.type === 'page') {
      bulkMovePagesMutation.mutate({ pageIds: [item.id], parentId: targetFolderId }, { onSuccess });
    } else {
      bulkMoveFoldersMutation.mutate(
        { folderIds: [item.id], parentId: targetFolderId },
        { onSuccess },
      );
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch(`/api/pages/${item.id}/export/markdown`);
      if (!res.ok) throw new Error('Failed to export');
      const blob = await res.blob();
      if (!identityLifecycle.isActive()) return;
      const disposition = res.headers.get('content-disposition');
      const match = disposition?.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? `${item.title || 'page'}.md`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showSuccessToast('Exported to markdown');
    } catch {
      if (!identityLifecycle.isActive()) return;
      showErrorToast('Failed to export note');
    }
  };

  const handleToggleFavorite = () => {
    if (!identityLifecycle.isActive()) return;
    toggleFavoriteMutation.mutate({
      entityType: item.type,
      entityId: item.id,
      title: item.title,
      icon: item.icon ?? null,
      ownerId: item.ownerId ?? null,
      isFavorite,
    });
  };

  const confirmRemoval = async (action: 'trash' | 'remove') => {
    try {
      if (action === 'trash') {
        await moveToTrash(item, { force: item.type === 'folder' });
      } else {
        await removeFromView(item);
      }
      setPendingRemovalAction(null);
    } catch {
      // Error toast handled globally by MutationCache.onError
    }
  };

  const items = [
    item.type === 'page' &&
      !isAnonymous && {
        label: 'Export',
        icon: <Download size={14} />,
        onClick: handleExport,
      },
    canMove && {
      label: 'Move',
      icon: <FolderInput size={14} />,
      onClick: () => setMoveDialogOpen(true),
    },
    (!isAnonymous || onCopy) && {
      label: 'Copy',
      icon: <Copy size={14} />,
      onClick: onCopy ?? handleCopy,
    },
    isAdmin && {
      label: 'Move to Trash',
      icon: <Trash2 size={14} />,
      className: '!text-red-600 dark:!text-red-400 data-highlighted:!bg-red-500/10',
      onClick: () => setPendingRemovalAction('trash'),
    },
    canRemoveFromView && {
      label: 'Remove for me',
      icon: <EyeOff size={14} />,
      className: '!text-red-600 dark:!text-red-400 data-highlighted:!bg-red-500/10',
      onClick: () => setPendingRemovalAction('remove'),
    },
  ].filter((item) => !!item);

  const dialogs = (
    <>
      {showShareDialog && (
        <ShareDialog
          entityType={item.type}
          entityId={item.id}
          title={item.title}
          onClose={() => setShowShareDialog(false)}
        />
      )}
      {moveDialogOpen && (
        <MoveDialog
          isOpen
          folders={foldersQuery.data ?? []}
          isLoading={foldersQuery.isLoading}
          movingFolderIds={item.type === 'folder' ? [item.id] : []}
          movingOwnerId={item.ownerId}
          allowRoot={allowMoveToRoot}
          onClose={() => setMoveDialogOpen(false)}
          onConfirm={handleConfirmMove}
        />
      )}
      {pendingRemovalAction !== null && (
        <ConfirmDialog
          isOpen
          title={
            pendingRemovalAction === 'trash'
              ? `Move “${item.title}” to Trash?`
              : `Remove “${item.title}” from your view?`
          }
          message={
            pendingRemovalAction === 'trash'
              ? item.type === 'folder'
                ? 'This folder and all of its contents will be moved to Trash. You can restore them later.'
                : 'This page will be moved to Trash. You can restore it later.'
              : 'This item will disappear from your workspace. The owner can share it with you again.'
          }
          confirmText={pendingRemovalAction === 'trash' ? 'Move to Trash' : 'Remove for me'}
          onConfirm={() => void confirmRemoval(pendingRemovalAction)}
          onCancel={() => setPendingRemovalAction(null)}
          loading={isRemovalPending}
          loadingText={pendingRemovalAction === 'trash' ? 'Moving...' : 'Removing...'}
        />
      )}
    </>
  );

  return {
    favorite: {
      label: isFavorite ? 'Unfavorite' : 'Favorite',
      icon: <Star size={14} className={isFavorite ? 'text-yellow-500 fill-yellow-500' : ''} />,
      onClick: handleToggleFavorite,
    },
    rename:
      onRename && canRename
        ? { label: 'Rename', icon: <Edit2 size={14} />, onClick: onRename }
        : null,
    share: {
      label: 'Share',
      icon: <Share size={14} />,
      onClick: () => setShowShareDialog(true),
    },
    items,
    dialogs,
  };
}
