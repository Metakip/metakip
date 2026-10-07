import type { SharePermission } from '@metakip/shared';
import { Copy, Download, Edit2, EyeOff, FolderInput, Share, Star, Trash2 } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useClipboard } from '../../contexts/ClipboardContext';
import { useIdentityLifecycle } from '../../contexts/IdentityLifecycleContext';
import { useShareContext } from '../../contexts/ShareContext';
import { useBulkMoveFolders, useBulkMovePages } from '../../hooks/use-bulk-actions';
import { useToggleFavorite } from '../../hooks/use-favorites';
import { useFolderTree } from '../../hooks/use-folders';
import { useWorkspaceMemberships } from '../../hooks/use-workspace';
import { useAuth } from '../../hooks/useAuth';
import {
  canRenameEntity,
  isOwnedByUser,
  preservesEffectiveOwnerAtRoot,
  useEntityDeletion,
} from '../../utils/entity-actions';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
// showErrorToast kept for non-mutation use in handleExport
import { ConfirmDialog } from '../ConfirmDialog';
import { ShareDialog } from '../editor/ShareDialog';
import { MoveDialog } from '../workspace/MoveDialog';
import { KebabMenu } from './KebabMenu';

type PageContextMenuProps = {
  item: {
    id: string;
    type: 'page' | 'folder';
    title: string;
    icon?: string | null;
    ownerId?: string | null | undefined;
    createdBy?: string | null | undefined;
    userPermission?: SharePermission | null | undefined;
    shareSource?: 'direct' | 'public' | 'workspace' | undefined;
    canMove?: boolean | undefined;
  };
  isFavorite?: boolean;
  triggerClassName?: string;
  menuClassName?: string;
  onOpenChange?: ((isOpen: boolean) => void) | undefined;
  onRename?: () => void;
  onDeleted?: () => void;
  onCopy?: () => void;
  onMutated?: () => void;
};

export function PageContextMenu({
  item,
  isFavorite = false,
  triggerClassName,
  menuClassName,
  onOpenChange,
  onRename,
  onDeleted,
  onCopy,
  onMutated,
}: PageContextMenuProps) {
  const identityLifecycle = useIdentityLifecycle();
  const clipboard = useClipboard();
  const { isAnonymous } = useShareContext();
  const { data: session } = useAuth();
  const currentUserId = session?.user?.id;
  const toggleFavoriteMutation = useToggleFavorite();
  const bulkMovePagesMutation = useBulkMovePages();
  const bulkMoveFoldersMutation = useBulkMoveFolders();
  const { data: folders } = useFolderTree({ enabled: !isAnonymous });
  const { data: workspaceMemberships } = useWorkspaceMemberships({ enabled: !isAnonymous });
  const {
    moveToTrash,
    removeFromView,
    isPending: isRemovalPending,
  } = useEntityDeletion({
    entityType: item.type,
    currentUserId,
    onSuccess: () => {
      onDeleted?.();
      onMutated?.();
    },
  });

  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [pendingRemovalAction, setPendingRemovalAction] = useState<'trash' | 'remove' | null>(null);

  const isOwned = currentUserId ? isOwnedByUser(item, currentUserId) : false;
  const isAdmin = isOwned || item.userPermission === 'admin';
  const canRename = canRenameEntity(item, currentUserId);
  const canRemoveFromView =
    !isAnonymous && !isOwned && (item.shareSource === 'direct' || item.shareSource === 'public');
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

  const handleMove = () => {
    setMoveDialogOpen(true);
  };

  const handleConfirmMove = (targetFolderId: string | null) => {
    const onSuccess = () => {
      setMoveDialogOpen(false);
      onMutated?.();
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
    toggleFavoriteMutation.mutate(
      {
        entityType: item.type,
        entityId: item.id,
        title: item.title,
        icon: item.icon ?? null,
        ownerId: item.ownerId ?? null,
        isFavorite,
      },
      { onSuccess: () => onMutated?.() },
    );
  };

  const removalEntity = {
    id: item.id,
    type: item.type,
    title: item.title,
    ownerId: item.ownerId,
    createdBy: item.createdBy,
    userPermission: item.userPermission,
    shareSource: item.shareSource,
  };

  const confirmRemoval = async () => {
    const action = pendingRemovalAction;
    if (!action) return;
    try {
      if (action === 'trash') {
        await moveToTrash(removalEntity, { force: item.type === 'folder' });
      } else {
        await removeFromView(removalEntity);
      }
      setPendingRemovalAction(null);
    } catch {
      // Error toast handled globally by MutationCache.onError
    }
  };

  const menuItems = [
    !isAnonymous && {
      label: isFavorite ? 'Unfavorite' : 'Favorite',
      icon: <Star size={14} className={isFavorite ? 'text-yellow-500 fill-yellow-500' : ''} />,
      onClick: handleToggleFavorite,
    },
    onRename &&
      canRename && {
        label: 'Rename',
        icon: <Edit2 size={14} />,
        onClick: onRename,
      },
    !isAnonymous && {
      label: 'Share',
      icon: <Share size={14} />,
      onClick: () => setShowShareDialog(true),
    },
    item.type === 'page' &&
      !isAnonymous && {
        label: 'Export',
        icon: <Download size={14} />,
        onClick: handleExport,
      },
    isAdmin && {
      label: 'Move to Trash',
      icon: <Trash2 size={14} className="text-red-600 dark:text-red-400" />,
      className: '!text-red-600 dark:!text-red-400 hover:!bg-red-500/10',
      onClick: () => setPendingRemovalAction('trash'),
    },
    canRemoveFromView && {
      label: 'Remove for me',
      icon: <EyeOff size={14} className="text-red-600 dark:text-red-400" />,
      className: '!text-red-600 dark:!text-red-400 hover:!bg-red-500/10',
      dividerBefore: isAdmin,
      onClick: () => setPendingRemovalAction('remove'),
    },
    canMove && {
      label: 'Move',
      icon: <FolderInput size={14} />,
      onClick: handleMove,
    },
    (!isAnonymous || onCopy) && {
      label: 'Copy',
      icon: <Copy size={14} />,
      onClick: onCopy ?? handleCopy,
    },
  ].filter(Boolean) as {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    className?: string;
    dividerBefore?: boolean;
  }[];

  return (
    <>
      <KebabMenu
        {...(triggerClassName != null ? { triggerClassName } : {})}
        {...(menuClassName != null ? { menuClassName } : {})}
        {...(onOpenChange != null ? { onOpenChange } : {})}
        items={menuItems}
      />
      {showShareDialog && (
        <ShareDialog
          entityType={item.type}
          entityId={item.id}
          title={item.title}
          onClose={() => setShowShareDialog(false)}
        />
      )}
      <MoveDialog
        isOpen={moveDialogOpen}
        folders={folders ?? []}
        movingFolderIds={item.type === 'folder' ? [item.id] : []}
        {...(item.ownerId !== undefined ? { movingOwnerId: item.ownerId } : {})}
        allowRoot={allowMoveToRoot}
        onClose={() => setMoveDialogOpen(false)}
        onConfirm={handleConfirmMove}
      />
      <ConfirmDialog
        isOpen={pendingRemovalAction !== null}
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
        onConfirm={() => void confirmRemoval()}
        onCancel={() => setPendingRemovalAction(null)}
        loading={isRemovalPending}
        loadingText={pendingRemovalAction === 'trash' ? 'Moving...' : 'Removing...'}
      />
    </>
  );
}
