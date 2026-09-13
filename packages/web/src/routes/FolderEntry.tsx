import type { CollaboratorDisplay, FolderTreeNode } from '@metakip/shared';
import {
  ChevronRight,
  FilePlus2,
  FileText,
  FolderPlus,
  Home as HomeIcon,
  LayoutGrid,
  List,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ExplorerItem, type ExplorerItemData } from '../components/workspace/ExplorerItem';
import { ExplorerLoadingState } from '../components/workspace/ExplorerLoadingState';
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
import { useFavorites } from '../hooks/use-favorites';
import { useFolderTree, useUpdateFolder } from '../hooks/use-folders';
import { useFolderCollaborators, usePageCollaborators } from '../hooks/use-page-collaborators';
import { usePageTree, useUpdatePage } from '../hooks/use-pages';
import { useWorkspaceMemberships } from '../hooks/use-workspace';
import { useAuth } from '../hooks/useAuth';
import { useEntityCreationActions } from '../hooks/useEntityCreationActions';
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
  const { data: favorites } = useFavorites({ enabled: !isAnonymous });
  const { data: workspaceMemberships } = useWorkspaceMemberships({ enabled: !isAnonymous });
  const { data: session } = useAuth();
  const currentUserId = session?.user?.id;
  const canManageFolder = !!currentUserId && capabilities.canDelete;
  const canCreateChildren = !isAnonymous && capabilities.canEdit;

  const bulkRemoveMutation = useBulkRemoveEntities();
  const refreshedFavoriteKeys = useMemo(
    () => new Set(favorites?.map((fav) => `${fav.entityType}:${fav.entityId}`) ?? []),
    [favorites],
  );
  const favoriteKeys = useStableValueWhile(refreshedFavoriteKeys, bulkRemoveMutation.isPending);
  const isFavoriteItem = (item: ExplorerItemData) => favoriteKeys.has(`${item.type}:${item.id}`);

  const entityCreation = useEntityCreationActions();
  const updatePageMutation = useUpdatePage();
  const updateFolderMutation = useUpdateFolder();
  const copyPageMutation = useCopyPage();
  const copyFolderMutation = useCopyFolder();
  const bulkMovePagesMutation = useBulkMovePages();
  const bulkMoveFoldersMutation = useBulkMoveFolders();

  const clipboard = useClipboard();
  const selection = useSelection();

  const filterOutSelf = useMemo(
    () =>
      (collaborators: CollaboratorDisplay[]): CollaboratorDisplay[] =>
        currentUserId
          ? collaborators.filter((collaborator) => collaborator.userId !== currentUserId)
          : collaborators,
    [currentUserId],
  );

  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    const saved = localStorage.getItem('metakip:viewMode');
    return saved === 'list' ? 'list' : 'card';
  });
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<{
    kind: 'page' | 'folder';
    id: string;
    value: string;
  } | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [removalFailure, setRemovalFailure] = useState<{
    message: string;
    canRetry: boolean;
  } | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selection.clear();
    setLastSelectedIndex(null);
  }, [selection.clear]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(event.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const favoriteItems = useMemo(
    () => allItems.filter((item) => favoriteKeys.has(`${item.type}:${item.id}`)),
    [allItems, favoriteKeys],
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
        setEditingTarget({ kind: 'folder', id: folder.id, value: folder.name });
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
    setEditingTarget({ kind: currentItem.type, id: currentItem.id, value: currentItem.title });
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
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FileText size={48} className="text-zinc-300 dark:text-zinc-600 mb-4" />
        <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">Invalid folder</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
          This folder URL is not valid.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 min-w-0">
          <Link
            to={getWorkspacePath()}
            className="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <HomeIcon size={14} />
            <span className="font-medium">Home</span>
          </Link>
          {breadcrumbPath.map((folder) => (
            <React.Fragment key={folder.id}>
              <ChevronRight size={14} className="mx-1 shrink-0" />
              <Link
                to={buildFolderPath(folder.name, folder.id)}
                className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors truncate"
              >
                {folder.name}
              </Link>
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => {
                setViewMode('card');
                localStorage.setItem('metakip:viewMode', 'card');
              }}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'card' ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
              title="Card view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode('list');
                localStorage.setItem('metakip:viewMode', 'list');
              }}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${viewMode === 'list' ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'}`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
          {canCreateChildren && (
            <div className="relative flex items-stretch" ref={newMenuRef}>
              <button
                type="button"
                onClick={handleCreatePage}
                className="flex items-center gap-1.5 pl-3 pr-2 h-7 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-l-lg text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer border border-zinc-200 dark:border-zinc-700 border-r-0"
              >
                <FilePlus2 size={14} />
                <span className="hidden sm:inline">New Page</span>
              </button>
              <button
                type="button"
                onClick={() => setShowNewMenu((prev) => !prev)}
                className="flex items-center px-1.5 h-7 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-r-lg text-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer border border-zinc-200 dark:border-zinc-700"
              >
                <ChevronRight size={14} className="rotate-90" />
              </button>
              {showNewMenu && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 p-1.5 flex flex-col animate-scale-in origin-top-right">
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewMenu(false);
                      void handleCreatePage();
                    }}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/10 w-full text-left cursor-pointer rounded-xl transition-colors"
                  >
                    <FilePlus2 size={14} /> New Page
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewMenu(false);
                      void handleCreateFolder();
                    }}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/10 w-full text-left cursor-pointer rounded-xl transition-colors"
                  >
                    <FolderPlus size={14} /> New Folder
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {initialQueriesState.status === 'error' || initialQueriesState.status === 'paused' ? (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md flex items-center justify-between">
          <span>
            {initialQueriesState.status === 'paused'
              ? 'Loading is paused. Check your connection.'
              : 'Failed to load items.'}
          </span>
          <button
            type="button"
            onClick={() => void Promise.all([refetchPages(), refetchFolders()])}
            className="px-3 py-1 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 rounded text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      ) : initialQueriesState.status === 'loading' ? (
        <ExplorerLoadingState />
      ) : allItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText size={48} className="text-zinc-300 dark:text-zinc-600 mb-4" />
          <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">No items yet</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
            {canCreateChildren
              ? 'Create a new page or folder to get started.'
              : 'No items in this folder.'}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className="space-y-8 animate-fade-in">
          {favoriteItems.length > 0 && (
            <div>
              <h2 className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3 px-1">
                Favorites
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {favoriteItems.map((item) => (
                  <ExplorerItem
                    key={`${item.type}-${item.id}`}
                    item={item}
                    viewMode="card"
                    isSelected={selection.isSelected(item.id)}
                    isFavorite={isFavoriteItem(item)}
                    onSelect={(e) => {
                      e.stopPropagation();
                      selection.toggle({ id: item.id, type: item.type });
                    }}
                    onNavigate={(e) => handleItemClick(item, allItemIndexMap.get(item.id) ?? 0, e)}
                    {...(canRenameEntity(item, currentUserId)
                      ? { onRename: () => handleRenameItem(item) }
                      : {})}
                    collaborators={filterOutSelf(item.collaborators ?? [])}
                    canSelect={!isAnonymous && !bulkRemoveMutation.isPending}
                    showContextMenu={!isAnonymous}
                  />
                ))}
              </div>
            </div>
          )}
          <div>
            <h2 className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3 px-1">
              All Pages
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allItems.map((item, index) => (
                <ExplorerItem
                  key={`${item.type}-${item.id}`}
                  item={item}
                  viewMode="card"
                  isSelected={selection.isSelected(item.id)}
                  isFavorite={isFavoriteItem(item)}
                  onSelect={(e) => {
                    e.stopPropagation();
                    selection.toggle({ id: item.id, type: item.type });
                  }}
                  onNavigate={(e) => handleItemClick(item, index, e)}
                  {...(canRenameEntity(item, currentUserId)
                    ? { onRename: () => handleRenameItem(item) }
                    : {})}
                  isEditing={
                    canRenameEditingTarget &&
                    editingTarget?.kind === item.type &&
                    editingTarget.id === item.id
                  }
                  editValue={editingTarget?.value ?? ''}
                  onEditChange={(value) =>
                    setEditingTarget((prev) => (prev ? { ...prev, value } : null))
                  }
                  onEditSave={handleSaveRename}
                  onEditKeyDown={handleEditKeyDown}
                  collaborators={filterOutSelf(item.collaborators ?? [])}
                  canSelect={!isAnonymous && !bulkRemoveMutation.isPending}
                  showContextMenu={!isAnonymous}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {favoriteItems.length > 0 && (
            <div>
              <h2 className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3 px-1">
                Favorites
              </h2>
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-clip">
                <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                  <span className="w-8" />
                  <span className="-ml-10">Name</span>
                  <span className="hidden md:block w-28">Shared with</span>
                  <span className="hidden md:block w-36">Last edited</span>
                  <span className="w-8" />
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {favoriteItems.map((item) => (
                    <ExplorerItem
                      key={`${item.type}-${item.id}`}
                      item={item}
                      viewMode="list"
                      isSelected={selection.isSelected(item.id)}
                      isFavorite={isFavoriteItem(item)}
                      onSelect={(e) => {
                        e.stopPropagation();
                        selection.toggle({ id: item.id, type: item.type });
                      }}
                      onNavigate={(e) =>
                        handleItemClick(item, allItemIndexMap.get(item.id) ?? 0, e)
                      }
                      {...(canRenameEntity(item, currentUserId)
                        ? { onRename: () => handleRenameItem(item) }
                        : {})}
                      collaborators={filterOutSelf(item.collaborators ?? [])}
                      canSelect={!isAnonymous && !bulkRemoveMutation.isPending}
                      showContextMenu={!isAnonymous}
                      showCheckboxes={hasSelection}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div>
            <h2 className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3 px-1">
              All Pages
            </h2>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-clip">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                <span className="w-8" />
                <span className="-ml-10">Name</span>
                <span className="hidden md:block w-28">Shared with</span>
                <span className="hidden md:block w-36">Last edited</span>
                <span className="w-8" />
              </div>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {allItems.map((item, index) => (
                  <ExplorerItem
                    key={`${item.type}-${item.id}`}
                    item={item}
                    viewMode="list"
                    isSelected={selection.isSelected(item.id)}
                    isFavorite={isFavoriteItem(item)}
                    onSelect={(e) => {
                      e.stopPropagation();
                      selection.toggle({ id: item.id, type: item.type });
                    }}
                    onNavigate={(e) => handleItemClick(item, index, e)}
                    {...(canRenameEntity(item, currentUserId)
                      ? { onRename: () => handleRenameItem(item) }
                      : {})}
                    isEditing={
                      canRenameEditingTarget &&
                      editingTarget?.kind === item.type &&
                      editingTarget.id === item.id
                    }
                    editValue={editingTarget?.value ?? ''}
                    onEditChange={(value) =>
                      setEditingTarget((prev) => (prev ? { ...prev, value } : null))
                    }
                    onEditSave={handleSaveRename}
                    onEditKeyDown={handleEditKeyDown}
                    collaborators={filterOutSelf(item.collaborators ?? [])}
                    canSelect={!isAnonymous && !bulkRemoveMutation.isPending}
                    showContextMenu={!isAnonymous}
                    showCheckboxes={hasSelection}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
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
          onSelectAll={() => selection.selectAll(allItems.map((i) => ({ id: i.id, type: i.type })))}
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
  );
}
