import { FileText, Folder as FolderIcon, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { WorkspacePageToolbar } from '../components/workspace/WorkspacePageToolbar';
import { usePermanentDeleteFolder, useRestoreFolder, useTrashFolders } from '../hooks/use-folders';
import { usePermanentDeletePage, useRestorePage, useTrashPages } from '../hooks/use-pages';
import { useEmptyAllTrash } from '../hooks/use-trash';

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
    <div className="max-w-3xl space-y-8">
      <WorkspacePageToolbar
        title="Trash"
        actions={
          trashItems.length > 0 && (
            <button
              type="button"
              onClick={() => setShowEmptyAllConfirm(true)}
              disabled={emptyAllPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-800 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Trash2 size={14} />
              <span>Empty all</span>
            </button>
          )
        }
      />
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Trash</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Deleted pages and folders appear here. Restore them or delete permanently.
        </p>
      </div>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-zinc-900 dark:border-zinc-100" />
          </div>
        ) : hasError ? (
          <div className="py-8 text-center" role="alert">
            <p className="text-sm text-red-600 dark:text-red-400">Could not load Trash.</p>
            <button
              type="button"
              onClick={() => {
                void refetchPages();
                void refetchFolders();
              }}
              className="mt-3 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : trashItems.length > 0 ? (
          <div className="space-y-2">
            {trashItems.map((item) => (
              <div
                key={`${item.type}:${item.id}`}
                className="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex-shrink-0 text-zinc-400 dark:text-zinc-500">
                    {item.icon ? (
                      <span className="text-lg leading-none">{item.icon}</span>
                    ) : item.type === 'folder' ? (
                      <FolderIcon size={18} />
                    ) : (
                      <FileText size={18} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {item.title || (item.type === 'folder' ? 'Untitled folder' : 'Untitled')}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {item.type === 'folder' ? 'Folder' : 'Page'} · Deleted{' '}
                      {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : 'Unknown'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  <button
                    type="button"
                    onClick={() => handleRestore(item)}
                    disabled={restorePending}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 cursor-pointer"
                    title={`Restore ${item.type}`}
                  >
                    <RotateCcw size={14} />
                    <span>Restore</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setItemToDelete(item)}
                    disabled={permanentDeletePending}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-200 dark:hover:border-red-800 transition-colors disabled:opacity-50 cursor-pointer"
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
