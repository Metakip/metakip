import * as stylex from '@stylexjs/stylex';
import { FileText, Folder as FolderIcon, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { WorkspacePageToolbar } from '../components/workspace/WorkspacePageToolbar';
import { usePermanentDeleteFolder, useRestoreFolder, useTrashFolders } from '../hooks/use-folders';
import { usePermanentDeletePage, useRestorePage, useTrashPages } from '../hooks/use-pages';
import { useEmptyAllTrash } from '../hooks/use-trash';
import { styles } from './Trash.stylex';

type TrashItem = {
  id: string;
  type: 'folder' | 'page';
  title: string;
  icon: string | null;
  deletedAt: Date | string | null | undefined;
};

export default function Trash() {
  const {
    data: trashPages,
    isLoading: pagesLoading,
    isError: pagesError,
    refetch: refetchPages,
  } = useTrashPages();
  const {
    data: trashFolders,
    isLoading: foldersLoading,
    isError: foldersError,
    refetch: refetchFolders,
  } = useTrashFolders();
  const restorePageMutation = useRestorePage();
  const restoreFolderMutation = useRestoreFolder();
  const permanentDeletePageMutation = usePermanentDeletePage();
  const permanentDeleteFolderMutation = usePermanentDeleteFolder();
  const emptyAllTrashMutation = useEmptyAllTrash();

  const [itemToDelete, setItemToDelete] = useState<TrashItem | null>(null);
  const [showEmptyAllConfirm, setShowEmptyAllConfirm] = useState(false);

  const trashItems: TrashItem[] = [
    ...(trashFolders ?? []).map((folder) => ({
      id: folder.id,
      type: 'folder' as const,
      title: folder.name,
      icon: folder.icon,
      deletedAt: folder.deletedAt,
    })),
    ...(trashPages ?? []).map((page) => ({
      id: page.id,
      type: 'page' as const,
      title: page.title,
      icon: page.icon,
      deletedAt: page.deletedAt,
    })),
  ].sort((first, second) => {
    const firstDeletedAt = first.deletedAt ? new Date(first.deletedAt).getTime() : 0;
    const secondDeletedAt = second.deletedAt ? new Date(second.deletedAt).getTime() : 0;
    return secondDeletedAt - firstDeletedAt;
  });

  const isLoading = pagesLoading || foldersLoading;
  const hasError = pagesError || foldersError;
  const restorePending = restorePageMutation.isPending || restoreFolderMutation.isPending;
  const permanentDeletePending =
    permanentDeletePageMutation.isPending || permanentDeleteFolderMutation.isPending;
  const emptyAllPending = emptyAllTrashMutation.isPending;

  const handleRestore = (item: TrashItem) => {
    if (item.type === 'folder') {
      restoreFolderMutation.mutate(item.id);
      return;
    }
    restorePageMutation.mutate(item.id);
  };

  const handlePermanentDelete = () => {
    if (!itemToDelete) return;
    const options = { onSuccess: () => setItemToDelete(null) };
    if (itemToDelete.type === 'folder') {
      permanentDeleteFolderMutation.mutate(itemToDelete.id, options);
      return;
    }
    permanentDeletePageMutation.mutate(itemToDelete.id, options);
  };

  const handleEmptyAll = async () => {
    try {
      await emptyAllTrashMutation.mutateAsync();
      setShowEmptyAllConfirm(false);
    } catch {
      // The shared mutation error handler presents the failed request to the user.
    }
  };

  return (
    <div {...stylex.props(styles.trash)}>
      <WorkspacePageToolbar
        title="Trash"
        actions={
          trashItems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowEmptyAllConfirm(true)}
              disabled={emptyAllPending}
              {...stylex.props(styles.button, styles.destructiveButton)}
            >
              <Trash2 size={14} />
              <span>Empty all</span>
            </button>
          )
        }
      />
      <div>
        <h1 {...stylex.props(styles.pageTitle)}>Trash</h1>
        <p {...stylex.props(styles.pageDescription)}>
          Deleted pages and folders appear here. Restore them or delete permanently.
        </p>
      </div>

      <section {...stylex.props(styles.card)}>
        {isLoading ? (
          <div {...stylex.props(styles.loadingState)}>
            <div {...stylex.props(styles.spinner)} />
          </div>
        ) : hasError ? (
          <div {...stylex.props(styles.errorState)} role="alert">
            <p {...stylex.props(styles.errorMessage)}>Could not load Trash.</p>
            <button
              type="button"
              onClick={() => {
                void refetchPages();
                void refetchFolders();
              }}
              {...stylex.props(styles.retryButton)}
            >
              Retry
            </button>
          </div>
        ) : trashItems.length > 0 ? (
          <div {...stylex.props(styles.itemList)}>
            {trashItems.map((item) => (
              <div key={`${item.type}:${item.id}`} {...stylex.props(styles.trashItem)}>
                <div {...stylex.props(styles.itemContent)}>
                  <div {...stylex.props(styles.itemIcon)}>
                    {item.icon ? (
                      <span {...stylex.props(styles.itemEmoji)}>{item.icon}</span>
                    ) : item.type === 'folder' ? (
                      <FolderIcon size={18} />
                    ) : (
                      <FileText size={18} />
                    )}
                  </div>
                  <div {...stylex.props(styles.itemText)}>
                    <p {...stylex.props(styles.itemTitle)}>
                      {item.title || (item.type === 'folder' ? 'Untitled folder' : 'Untitled')}
                    </p>
                    <p {...stylex.props(styles.itemMeta)}>
                      {item.type === 'folder' ? 'Folder' : 'Page'} · Deleted{' '}
                      {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : 'Unknown'}
                    </p>
                  </div>
                </div>
                <div {...stylex.props(styles.itemActions)}>
                  <button
                    type="button"
                    onClick={() => handleRestore(item)}
                    disabled={restorePending}
                    {...stylex.props(styles.button, styles.restoreButton)}
                    title={`Restore ${item.type}`}
                  >
                    <RotateCcw size={14} />
                    <span>Restore</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setItemToDelete(item)}
                    disabled={permanentDeletePending}
                    {...stylex.props(styles.button, styles.destructiveButton)}
                    title={`Delete ${item.type} permanently`}
                  >
                    <Trash2 size={14} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Trash2 size={24} />}
            title="Trash is empty"
            description="Deleted pages and folders will appear here."
          />
        )}
      </section>

      <ConfirmDialog
        isOpen={!!itemToDelete}
        title="Delete permanently"
        message={`Are you sure you want to permanently delete "${
          itemToDelete?.title || (itemToDelete?.type === 'folder' ? 'Untitled folder' : 'Untitled')
        }"?${
          itemToDelete?.type === 'folder'
            ? ' All pages and folders inside it will also be deleted.'
            : ''
        } This action cannot be undone.`}
        confirmText="Delete permanently"
        onConfirm={handlePermanentDelete}
        onCancel={() => setItemToDelete(null)}
        loading={permanentDeletePending}
      />

      <ConfirmDialog
        isOpen={showEmptyAllConfirm}
        title="Empty trash"
        message={`Are you sure you want to permanently delete all ${trashItems.length} top-level ${
          trashItems.length === 1 ? 'item' : 'items'
        } in Trash? Folder contents will also be deleted. This action cannot be undone.`}
        confirmText="Empty trash"
        onConfirm={() => void handleEmptyAll()}
        onCancel={() => setShowEmptyAllConfirm(false)}
        loading={emptyAllPending}
      />
    </div>
  );
}
