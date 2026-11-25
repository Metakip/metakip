import type { FolderTreeNode } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { FileText } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import type { ExplorerItemData } from '../components/workspace/ExplorerItem';
import { ExplorerItemSections } from '../components/workspace/ExplorerItemSections';
import { ExplorerLoadingState } from '../components/workspace/ExplorerLoadingState';
import { ExplorerToolbar } from '../components/workspace/ExplorerToolbar';
import { MoveDialog } from '../components/workspace/MoveDialog';
import { SelectionToolbar } from '../components/workspace/SelectionToolbar';
import { useClipboard } from '../contexts/ClipboardContext';
import { useIdentityLifecycle, useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { useSelection } from '../contexts/SelectionContext';
import { useShareContext } from '../contexts/ShareContext';
import {
  buildBulkRemovalInput,
  canRetryBulkRemoval,
  formatBulkRemovalFailure,
  getBulkRemovalCounts,
  useBulkMoveFolders,
  useBulkMovePages,
  useBulkRemoveEntities,
} from '../hooks/use-bulk-actions';
import { useCopyFolder, useCopyPage } from '../hooks/use-copy';
import { useFolderTree, useUpdateFolder } from '../hooks/use-folders';
import { useFolderCollaborators, usePageCollaborators } from '../hooks/use-page-collaborators';
import { usePageTree, useUpdatePage } from '../hooks/use-pages';
import { useStars } from '../hooks/use-stars';
import { useWorkspaceMemberships } from '../hooks/use-workspace';
import { useAuth } from '../hooks/useAuth';
import { useEntityCreationActions } from '../hooks/useEntityCreationActions';
import { useExplorerViewMode } from '../hooks/useExplorerViewMode';
import { useStableValueWhile } from '../hooks/useStableValue';
import { canRenameEntity, preservesEffectiveOwnerAtRoot } from '../utils/entity-actions';
import { getInitialQueriesState } from '../utils/queryState';
import { showSuccessToast } from '../utils/toast';
import {
  buildFolderPath,
  buildPagePath,
  extractUuidFromSlug,
  getWorkspacePath,
  getWorkspacePathPrefix,
} from '../utils/url';
import { styles } from './ExplorerRoute.stylex';
import { getFolderContentsModel } from './folderContentsModel';

export default function FolderEntry() {
  const navigate = useIdentityNavigate();
  const location = useLocation();
  const identityLifecycle = useIdentityLifecycle();
  const { slugAndId } = useParams<{ slugAndId: string }>();
  const folderId = slugAndId ? extractUuidFromSlug(slugAndId) : undefined;
  const { capabilities, isAnonymous, publicEntity } = useShareContext();

  const pagesQuery = usePageTree({ enabled: !isAnonymous });
  const { data: pages, refetch: refetchPages } = pagesQuery;
  const foldersQuery = useFolderTree({
    enabled: !isAnonymous,
  });
  const { data: folders, refetch: refetchFolders } = foldersQuery;
  const { data: stars } = useStars({ enabled: !isAnonymous });
  const { data: workspaceMemberships } = useWorkspaceMemberships({ enabled: !isAnonymous });
  const { data: session } = useAuth();
  const currentUserId = session?.user?.id;
  const canManageFolder = !!currentUserId && capabilities.canDelete;
  const canCreateChildren = !isAnonymous && capabilities.canEdit;

  const bulkRemoveMutation = useBulkRemoveEntities();
  const refreshedStarKeys = useMemo(
    () => new Set(stars?.map((star) => `${star.entityType}:${star.entityId}`) ?? []),
    [stars],
  );
  const starKeys = useStableValueWhile(refreshedStarKeys, bulkRemoveMutation.isPending);
  const isStarredItem = (item: ExplorerItemData) => starKeys.has(`${item.type}:${item.id}`);

  const entityCreation = useEntityCreationActions();
  const updatePageMutation = useUpdatePage();
  const updateFolderMutation = useUpdateFolder();
  const copyPageMutation = useCopyPage();
  const copyFolderMutation = useCopyFolder();
  const bulkMovePagesMutation = useBulkMovePages();
  const bulkMoveFoldersMutation = useBulkMoveFolders();

  const clipboard = useClipboard();
  const selection = useSelection();

  const [viewMode, setViewMode] = useExplorerViewMode();
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<{
    kind: 'page' | 'folder';
    id: string;
    section: 'all-items';
    value: string;
  } | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [removalFailure, setRemovalFailure] = useState<{
    message: string;
    canRetry: boolean;
  } | null>(null);

  useEffect(() => {
    selection.clear();
    setLastSelectedIndex(null);
  }, [selection.clear]);

  const { currentFolder, currentFolders, currentPages, publicFolder, usesPublicPayload } = useMemo(
    () => getFolderContentsModel({ folderId, folders, pages, publicEntity, isAnonymous }),
    [folderId, folders, isAnonymous, pages, publicEntity],
  );

  useEffect(() => {
    if (!currentFolder || !slugAndId) return;
    const expectedSlug = buildFolderPath(currentFolder.name, currentFolder.id).slice(
      `${getWorkspacePathPrefix()}folder/`.length,
    );
    if (slugAndId === expectedSlug) return;
    navigate(
      {
        pathname: buildFolderPath(currentFolder.name, currentFolder.id),
        search: location.search,
        hash: location.hash,
      },
      { replace: true },
    );
  }, [currentFolder, slugAndId, navigate, location.search, location.hash]);

  const breadcrumbPath = useMemo(() => {
    if (!folderId) return [];
    if (publicFolder) return [publicFolder];
    const path: FolderTreeNode[] = [];
    const find = (nodes: FolderTreeNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === folderId) {
          path.push(currentFolder ?? node);
          return true;
        }
        if (node.children.length > 0) {
          if (find(node.children)) {
            path.unshift(node);
            return true;
          }
        }
      }
      return false;
    };
    find(folders ?? []);
    return path;
  }, [folders, folderId, publicFolder, currentFolder]);

  const pageIds = useMemo(() => currentPages.map((page) => page.id), [currentPages]);
  const { data: collaboratorsMap } = usePageCollaborators(pageIds);

  const childFolderIds = useMemo(() => currentFolders.map((folder) => folder.id), [currentFolders]);
  const { data: folderCollaboratorsMap } = useFolderCollaborators(childFolderIds);

  const refreshedItems: ExplorerItemData[] = useMemo(() => {
    const folderItems: ExplorerItemData[] = currentFolders.map((f) => ({
      id: f.id,
      type: 'folder',
      title: f.name,
      icon: f.icon,
      updatedAt: f.updatedAt,
      ownerId: f.ownerId,
      createdBy: f.createdBy,
      userPermission: f.userPermission ?? null,
      ...(f.workspaceAccess === true ? { shareSource: 'workspace' as const } : {}),
      canMove: canManageFolder && (f.ownerId === currentUserId || f.userPermission === 'admin'),
      ...(folderCollaboratorsMap?.[f.id] ? { collaborators: folderCollaboratorsMap[f.id] } : {}),
    }));
    const pageItems: ExplorerItemData[] = currentPages.map((p) => ({
      id: p.id,
      type: 'page',
      title: p.title,
      icon: p.icon,
      updatedAt: p.updatedAt,
      coverType: p.coverType,
      coverValue: p.coverValue,
      ownerId: p.ownerId,
      createdBy: p.createdBy,
      userPermission: p.userPermission ?? null,
      ...(p.workspaceAccess === true ? { shareSource: 'workspace' as const } : {}),
      canMove: canManageFolder && (p.ownerId === currentUserId || p.userPermission === 'admin'),
      ...(collaboratorsMap?.[p.id] ? { collaborators: collaboratorsMap[p.id] } : {}),
    }));
    return [...folderItems, ...pageItems];
  }, [
    currentFolders,
    currentPages,
    collaboratorsMap,
    folderCollaboratorsMap,
    canManageFolder,
    currentUserId,
  ]);
  const allItems = useStableValueWhile(refreshedItems, bulkRemoveMutation.isPending);
  const editingItem = editingTarget
    ? refreshedItems.find(
        (item) => item.type === editingTarget.kind && item.id === editingTarget.id,
      )
    : undefined;
  const canRenameEditingTarget = editingItem ? canRenameEntity(editingItem, currentUserId) : false;
  const renameCapabilityRef = useRef({ items: refreshedItems, currentUserId });
  renameCapabilityRef.current = { items: refreshedItems, currentUserId };

  useEffect(() => {
    if (editingTarget && editingItem && !canRenameEditingTarget) {
      setEditingTarget(null);
    }
  }, [canRenameEditingTarget, editingItem, editingTarget]);

  const starredItems = useMemo(
    () => allItems.filter((item) => starKeys.has(`${item.type}:${item.id}`)),
    [allItems, starKeys],
  );

  const allItemIndexMap = useMemo(
    () => new Map(allItems.map((item, index) => [item.id, index])),
    [allItems],
  );

  const hasSelection = selection.selectedCount > 0;

  const handleCreatePage = async () => {
    try {
      await entityCreation.createPageAndNavigate({ ...(folderId ? { parentId: folderId } : {}) });
    } catch {
      // Error toast handled globally by MutationCache.onError
    }
  };

  const handleCreateFolder = async () => {
    try {
      const folder = await entityCreation.createFolder({
        ...(folderId ? { parentId: folderId } : {}),
      });
      if (!folder) return;
      if (isAnonymous) {
        navigate(buildFolderPath(folder.name, folder.id));
      } else {
        setEditingTarget({
          kind: 'folder',
          id: folder.id,
          section: 'all-items',
          value: folder.name,
        });
      }
    } catch {
      // Error toast handled globally by MutationCache.onError
    }
  };

  const handleItemClick = (
    item: ExplorerItemData,
    index: number,
    e: React.MouseEvent | React.KeyboardEvent,
  ) => {
    if (e.ctrlKey || e.metaKey) {
      selection.toggle({ id: item.id, type: item.type });
      setLastSelectedIndex(index);
    } else if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const range = allItems.slice(start, end + 1).map((i) => ({ id: i.id, type: i.type }));
      selection.selectAll(range);
    } else {
      if (item.type === 'folder') {
        navigate(buildFolderPath(item.title, item.id));
      } else {
        navigate(buildPagePath(item.title, item.id));
      }
    }
  };

  const handleRenameItem = (item: ExplorerItemData) => {
    const { items, currentUserId: latestUserId } = renameCapabilityRef.current;
    const currentItem = items.find(
      (candidate) => candidate.type === item.type && candidate.id === item.id,
    );
    if (!currentItem || !canRenameEntity(currentItem, latestUserId)) return;
    setEditingTarget({
      kind: currentItem.type,
      id: currentItem.id,
      section: 'all-items',
      value: currentItem.title,
    });
  };

  const handleSaveRename = () => {
    if (!editingTarget) return;
    const { items, currentUserId: latestUserId } = renameCapabilityRef.current;
    const currentItem = items.find(
      (item) => item.type === editingTarget.kind && item.id === editingTarget.id,
    );
    if (!currentItem || !canRenameEntity(currentItem, latestUserId)) {
      setEditingTarget(null);
      return;
    }
    const trimmed = editingTarget.value.trim();
    const onSettled = () => setEditingTarget(null);
    if (editingTarget.kind === 'folder') {
      updateFolderMutation.mutate(
        {
          folderId: editingTarget.id,
          updates: { name: trimmed.length > 0 ? trimmed : 'New Folder' },
        },
        { onSettled },
      );
    } else {
      updatePageMutation.mutate(
        { pageId: editingTarget.id, updates: { title: trimmed.length > 0 ? trimmed : 'Untitled' } },
        { onSettled },
      );
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveRename();
    } else if (e.key === 'Escape') {
      setEditingTarget(null);
    }
  };

  const selectedItems = useMemo(
    () =>
      selection.selectedItems.map((selected) => {
        const item = allItems.find(
          (candidate) => candidate.id === selected.id && candidate.type === selected.type,
        );
        return {
          ...selected,
          ownerId: item?.ownerId ?? null,
          createdBy: item?.createdBy ?? null,
          userPermission: item?.userPermission ?? null,
          shareSource: item?.shareSource,
          canMove: item?.canMove ?? false,
        };
      }),
    [selection.selectedItems, allItems],
  );

  const selectedRemovalInput = useMemo(
    () => buildBulkRemovalInput(selectedItems, currentUserId),
    [selectedItems, currentUserId],
  );
  const selectedRemovalCounts = getBulkRemovalCounts(selectedRemovalInput);
  const canRemoveSelection =
    selectedItems.length > 0 &&
    selectedRemovalCounts.trashCount + selectedRemovalCounts.removeFromViewCount > 0;
  const unremovableSelectionCount =
    selectedItems.length -
    selectedRemovalCounts.trashCount -
    selectedRemovalCounts.removeFromViewCount;
  const selectedOwnerIds = new Set(selectedItems.map((item) => item.ownerId));
  const selectedOwnerId = selectedOwnerIds.size === 1 ? selectedItems[0]?.ownerId : undefined;
  const canMoveSelection =
    selectedItems.length > 0 &&
    selectedOwnerIds.size === 1 &&
    selectedItems.every((item) => item.canMove);
  const hasWorkspaceRootAccess =
    selectedOwnerId === currentUserId ||
    workspaceMemberships?.some(
      (membership) => membership.ownerId === selectedOwnerId && membership.role === 'admin',
    ) === true;
  const canMoveSelectionToRoot =
    hasWorkspaceRootAccess && selectedItems.every(preservesEffectiveOwnerAtRoot);

  const handleBulkDelete = async () => {
    try {
      const result = await bulkRemoveMutation.mutateAsync(selectedRemovalInput);
      if (!identityLifecycle.isActive()) return;
      for (const item of result.removedItems) selection.deselect(item.entityId);
      setRemovalFailure(
        result.failedItems.length > 0
          ? { message: formatBulkRemovalFailure(result), canRetry: canRetryBulkRemoval(result) }
          : null,
      );
    } catch {
      // Network-level failures are reported by the global mutation cache.
    }
  };

  const handleBulkCopy = () => {
    clipboard.copy(selection.selectedItems);
    showSuccessToast('Copied to clipboard');
  };

  const handleBulkCut = () => {
    clipboard.cut(selection.selectedItems);
    showSuccessToast('Cut to clipboard');
  };

  const handleBulkMove = () => {
    setMoveDialogOpen(true);
  };

  const handleConfirmMove = async (targetFolderId: string | null) => {
    const pageIds = selection.selectedItems.filter((i) => i.type === 'page').map((i) => i.id);
    const folderIds = selection.selectedItems.filter((i) => i.type === 'folder').map((i) => i.id);

    try {
      if (pageIds.length > 0)
        await bulkMovePagesMutation.mutateAsync({
          pageIds,
          parentId: targetFolderId,
        });
      if (!identityLifecycle.isActive()) return;
      if (folderIds.length > 0)
        await bulkMoveFoldersMutation.mutateAsync({
          folderIds,
          parentId: targetFolderId,
        });
      if (!identityLifecycle.isActive()) return;
      selection.clear();
      setMoveDialogOpen(false);
    } catch {
      // Error toast handled globally by MutationCache.onError
    }
  };

  const handlePaste = async () => {
    if (!clipboard.state.action || clipboard.state.items.length === 0) return;
    if (clipboard.state.action === 'copy' && !canCreateChildren) return;
    if (clipboard.state.action === 'cut' && !canManageFolder) return;
    const currentParentId = folderId ?? null;

    try {
      if (clipboard.state.action === 'copy') {
        for (const item of clipboard.state.items) {
          if (!identityLifecycle.isActive()) return;
          if (item.type === 'page') {
            await copyPageMutation.mutateAsync({
              pageId: item.id,
              parentId: currentParentId,
            });
          } else {
            await copyFolderMutation.mutateAsync({
              folderId: item.id,
              parentId: currentParentId,
            });
          }
          if (!identityLifecycle.isActive()) return;
        }
        showSuccessToast('Pasted');
      } else if (clipboard.state.action === 'cut') {
        const pageIds = clipboard.state.items.filter((i) => i.type === 'page').map((i) => i.id);
        const folderIds = clipboard.state.items.filter((i) => i.type === 'folder').map((i) => i.id);
        if (pageIds.length > 0)
          await bulkMovePagesMutation.mutateAsync({
            pageIds,
            parentId: currentParentId,
          });
        if (!identityLifecycle.isActive()) return;
        if (folderIds.length > 0)
          await bulkMoveFoldersMutation.mutateAsync({
            folderIds,
            parentId: currentParentId,
          });
        if (!identityLifecycle.isActive()) return;
        clipboard.clear();
        showSuccessToast('Moved');
      }
    } catch {
      // Error toast handled globally by MutationCache.onError
    }
  };

  const initialQueriesState = usesPublicPayload
    ? ({ status: 'ready' } as const)
    : pagesQuery.error || foldersQuery.error
      ? ({ status: 'error' } as const)
      : getInitialQueriesState([pagesQuery, foldersQuery]);

  if (!folderId) {
    return (
      <div {...stylex.props(styles.emptyState)}>
        <FileText size={48} {...stylex.props(styles.emptyIcon)} />
        <h3 {...stylex.props(styles.emptyTitle)}>Invalid folder</h3>
        <p {...stylex.props(styles.emptyDescription)}>This folder URL is not valid.</p>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.route)}>
      <ExplorerToolbar
        breadcrumbs={breadcrumbPath}
        homeHref={getWorkspacePath()}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        canCreate={canCreateChildren}
        onCreatePage={handleCreatePage}
        onCreateFolder={handleCreateFolder}
      />

      <div className={`explorer-content ${stylex.props(styles.content).className ?? ''}`}>
        {initialQueriesState.status === 'error' || initialQueriesState.status === 'paused' ? (
          <div {...stylex.props(styles.loadError)}>
            <span>
              {initialQueriesState.status === 'paused'
                ? 'Loading is paused. Check your connection.'
                : 'Failed to load items.'}
            </span>
            <button
              type="button"
              onClick={() => void Promise.all([refetchPages(), refetchFolders()])}
              {...stylex.props(styles.retryErrorButton)}
            >
              Retry
            </button>
          </div>
        ) : initialQueriesState.status === 'loading' ? (
          <ExplorerLoadingState />
        ) : allItems.length === 0 ? (
          <div {...stylex.props(styles.emptyState)}>
            <FileText size={48} {...stylex.props(styles.emptyIcon)} />
            <h3 {...stylex.props(styles.emptyTitle)}>No items yet</h3>
            <p {...stylex.props(styles.emptyDescription)}>
              {canCreateChildren
                ? 'Create a new page or folder to get started.'
                : 'No items in this folder.'}
            </p>
          </div>
        ) : (
          <ExplorerItemSections
            sections={[
              { id: 'starred', title: 'Starred', items: starredItems },
              { id: 'all-items', title: 'All Pages', items: allItems },
            ]}
            viewMode={viewMode}
            showContextMenu={!isAnonymous}
            currentUserId={currentUserId}
            canSelect={!isAnonymous && !bulkRemoveMutation.isPending}
            hasSelection={hasSelection}
            editingTarget={canRenameEditingTarget ? editingTarget : null}
            isStarred={isStarredItem}
            isSelected={selection.isSelected}
            onSelect={(item, event) => {
              event.stopPropagation();
              selection.toggle({ id: item.id, type: item.type });
            }}
            onNavigate={(item, index, event) =>
              handleItemClick(item, allItemIndexMap.get(item.id) ?? index, event)
            }
            onRename={handleRenameItem}
            onEditChange={(value) =>
              setEditingTarget((previous) => (previous ? { ...previous, value } : null))
            }
            onEditSave={handleSaveRename}
            onEditKeyDown={handleEditKeyDown}
            animation="fast"
          />
        )}

        {!isAnonymous && (
          <SelectionToolbar
            selectedCount={selection.selectedCount}
            totalCount={allItems.length}
            clipboardCount={clipboard.state.items.length}
            onDelete={handleBulkDelete}
            onCopy={handleBulkCopy}
            onCut={handleBulkCut}
            onMove={handleBulkMove}
            canDelete={canRemoveSelection}
            trashCount={selectedRemovalCounts.trashCount}
            removeFromViewCount={selectedRemovalCounts.removeFromViewCount}
            unremovableCount={unremovableSelectionCount}
            removalFailureMessage={removalFailure?.message ?? null}
            canRetryRemoval={removalFailure?.canRetry ?? false}
            onDismissRemovalFailure={() => setRemovalFailure(null)}
            canMove={canMoveSelection}
            canPaste={
              clipboard.state.action === 'copy'
                ? canCreateChildren
                : clipboard.state.action === 'cut' && canManageFolder
            }
            isRemoving={bulkRemoveMutation.isPending}
            onPaste={() => void handlePaste()}
            onSelectAll={() =>
              selection.selectAll(allItems.map((i) => ({ id: i.id, type: i.type })))
            }
            onClear={() => {
              selection.clear();
              clipboard.clear();
            }}
          />
        )}

        <MoveDialog
          isOpen={moveDialogOpen}
          folders={folders ?? []}
          movingFolderIds={selection.selectedItems
            .filter((item) => item.type === 'folder')
            .map((item) => item.id)}
          {...(selectedOwnerId !== undefined ? { movingOwnerId: selectedOwnerId } : {})}
          allowRoot={canMoveSelectionToRoot}
          onClose={() => setMoveDialogOpen(false)}
          onConfirm={handleConfirmMove}
        />
      </div>
    </div>
  );
}
