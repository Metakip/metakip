import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Download,
  FilePlus2,
  FolderPlus,
  LogOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useEntityCommands } from '../../contexts/EntityCommandContext';
import { useIdentityLifecycle, useIdentityNavigate } from '../../contexts/IdentityLifecycleContext';
import { useShareContext } from '../../contexts/ShareContext';
import { useIsBulkRemovalPending } from '../../hooks/use-bulk-actions';
import { useFavorites } from '../../hooks/use-favorites';
import { useFolderTree, useUpdateFolder } from '../../hooks/use-folders';
import {
  useImportMarkdown,
  usePageTree,
  useRecentPages,
  useUpdatePage,
} from '../../hooks/use-pages';
import { useSharedWithMeTree } from '../../hooks/use-shared-with-me';
import { useLeaveWorkspace, useWorkspaceMemberships } from '../../hooks/use-workspace';
import { useAuth } from '../../hooks/useAuth';
import { useEntityCreationActions } from '../../hooks/useEntityCreationActions';
import { useStableValueWhile } from '../../hooks/useStableValue';
import { formatShortcut, SHORTCUT_PATTERNS } from '../../utils/keyboardShortcuts';
import { getInitialQueriesState } from '../../utils/queryState';
import { showErrorToast } from '../../utils/toast';
import { buildPagePath, extractUuidFromSlug, getWorkspacePath } from '../../utils/url';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { SidebarEntityRow } from './SidebarEntityRow';
import { SidebarAliasSection } from './SidebarSections';
import {
  OwnedFolderBranch,
  SharedNavigationBranch,
  WorkspaceFolderBranch,
  WorkspacePageRow,
} from './SidebarTreeBranches';
import type { SidebarTreeRuntime } from './sidebarRuntime';
import { useSidebarController } from './useSidebarController';
import { useSidebarEditing } from './useSidebarEditing';
import { useSidebarModel } from './useSidebarModel';

const SIDEBAR_PREVIEW_LIMIT = 8;

export function PageTree() {
  const navigate = useIdentityNavigate();
  const identityLifecycle = useIdentityLifecycle();
  const params = useParams();
  const activePageId = params.slugAndId ? extractUuidFromSlug(params.slugAndId) : undefined;
  const { isAnonymous } = useShareContext();
  const { data: session } = useAuth();
  const currentUserId = session?.user?.id;
  const createFolderShortcut = formatShortcut(SHORTCUT_PATTERNS.createFolder);
  const createNoteShortcut = formatShortcut(SHORTCUT_PATTERNS.createNote);

  const pagesQuery = usePageTree();
  const { data: refreshedPages, refetch: refetchPages } = pagesQuery;
  const foldersQuery = useFolderTree();
  const { data: refreshedFolders, refetch: refetchFolders } = foldersQuery;
  const favoritesQuery = useFavorites();
  const { data: refreshedFavorites, refetch: refetchFavorites } = favoritesQuery;
  const recentsQuery = useRecentPages(SIDEBAR_PREVIEW_LIMIT);
  const { data: refreshedRecentPages, refetch: refetchRecents } = recentsQuery;
  const sharedNavigationQuery = useSharedWithMeTree();
  const { data: refreshedSharedNavigation, refetch: refetchSharedNavigation } =
    sharedNavigationQuery;
  const workspaceMembershipsQuery = useWorkspaceMemberships();
  const { data: refreshedWorkspaceMemberships, refetch: refetchWorkspaceMemberships } =
    workspaceMembershipsQuery;
  const leaveWorkspaceMutation = useLeaveWorkspace();
  const isBulkRemovalPending = useIsBulkRemovalPending();
  const pages = useStableValueWhile(refreshedPages, isBulkRemovalPending);
  const folders = useStableValueWhile(refreshedFolders, isBulkRemovalPending);
  const favorites = useStableValueWhile(refreshedFavorites, isBulkRemovalPending);
  const recentPages = useStableValueWhile(refreshedRecentPages, isBulkRemovalPending);
  const sharedNavigation = useStableValueWhile(refreshedSharedNavigation, isBulkRemovalPending);
  const workspaceMemberships = useStableValueWhile(
    refreshedWorkspaceMemberships,
    isBulkRemovalPending,
  );

  const favoriteKeys = useMemo(
    () => new Set(favorites?.map((fav) => `${fav.entityType}:${fav.entityId}`) ?? []),
    [favorites],
  );
  const isFavoriteEntity = useCallback(
    (entityType: 'folder' | 'page', entityId: string) =>
      favoriteKeys.has(`${entityType}:${entityId}`),
    [favoriteKeys],
  );

  const { createPageAndNavigate, createFolder } = useEntityCreationActions();
  const entityCommands = useEntityCommands();
  const updatePageMutation = useUpdatePage();
  const updateFolderMutation = useUpdateFolder();
  const importMarkdownMutation = useImportMarkdown();
  const renamePage = useCallback(
    (pageId: string, title: string, onSettled: () => void) => {
      updatePageMutation.mutate({ pageId, updates: { title } }, { onSettled });
    },
    [updatePageMutation],
  );
  const renameFolder = useCallback(
    (folderId: string, name: string, onSettled: () => void) => {
      updateFolderMutation.mutate({ folderId, updates: { name } }, { onSettled });
    },
    [updateFolderMutation],
  );
  const {
    allPagesByFolder,
    canRenameSidebarEntity,
    directSharedNavigation,
    favoriteRows,
    foldersByParent,
    getSidebarAuthorization,
    getSidebarCapabilities,
    ownedFolders,
    pagesByFolder,
    recentRows,
    rootPages,
    sidebarFolderIds,
    workspaceGroups,
  } = useSidebarModel({
    currentUserId,
    pages: pages ?? [],
    folders: folders ?? [],
    favorites: favorites ?? [],
    recentPages: recentPages ?? [],
    sharedNavigation: sharedNavigation ?? [],
    workspaceMemberships: workspaceMemberships ?? [],
  });

  const {
    target: editingTarget,
    setTarget: setEditingTarget,
    save: saveRename,
    onKeyDown: onRenameKeyDown,
  } = useSidebarEditing({
    canRenameEntity: canRenameSidebarEntity,
    renamePage,
    renameFolder,
  });

  const sidebar = useSidebarController(sidebarFolderIds);

  const handleCreateRootPage = useCallback(async () => {
    try {
      const newPage = await createPageAndNavigate();
      if (!newPage) return;
      setEditingTarget({ kind: 'page', id: newPage.id, value: newPage.title ?? 'Untitled' });
    } catch {
      // Error toast handled globally by MutationCache.onError
    }
  }, [createPageAndNavigate, setEditingTarget]);

  const handleCreateRootFolder = useCallback(async () => {
    try {
      const folder = await createFolder();
      if (!folder) return;
      sidebar.expandFolder(folder.id);
      setEditingTarget({ kind: 'folder', id: folder.id, value: folder.name });
    } catch {
      // Error toast handled globally by MutationCache.onError
    }
  }, [createFolder, setEditingTarget, sidebar.expandFolder]);

  useEffect(() => {
    return entityCommands.register({
      createNote: () => void handleCreateRootPage(),
      createFolder: () => void handleCreateRootFolder(),
    });
  }, [entityCommands, handleCreateRootPage, handleCreateRootFolder]);

  const handleCreatePageInFolder = useCallback(
    async (folderId: string) => {
      try {
        const newPage = await createPageAndNavigate({ parentId: folderId });
        if (!newPage) return;
        sidebar.expandFolder(folderId);
        setEditingTarget({ kind: 'page', id: newPage.id, value: newPage.title ?? 'Untitled' });
      } catch {
        // Error toast handled globally by MutationCache.onError
      }
    },
    [createPageAndNavigate, setEditingTarget, sidebar.expandFolder],
  );

  const handleImportMarkdown = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.md')) {
      showErrorToast('Please select a markdown file (.md)');
      event.target.value = '';
      return;
    }

    try {
      const { page: newPage } = await importMarkdownMutation.mutateAsync({ file });
      if (!identityLifecycle.isActive()) return;
      navigate(buildPagePath(newPage.title, newPage.id));
    } catch {
      // Error toast handled globally by MutationCache.onError
    }
    event.target.value = '';
  };

  const sidebarTreeRuntime = useMemo<SidebarTreeRuntime>(
    () => ({
      activePageId,
      expandedFolderIds: sidebar.expandedFolderIds,
      editingTarget,
      getAuthorization: getSidebarAuthorization,
      getCapabilities: getSidebarCapabilities,
      isFavoriteEntity,
      toggleFolderExpanded: sidebar.toggleFolder,
      createPageInFolder: handleCreatePageInFolder,
      startEditing: (kind, id, value) => setEditingTarget({ kind, id, value }),
      setEditingValue: (kind, id, value) => setEditingTarget({ kind, id, value }),
      saveRename,
      onRenameKeyDown,
    }),
    [
      activePageId,
      editingTarget,
      getSidebarAuthorization,
      getSidebarCapabilities,
      handleCreatePageInFolder,
      isFavoriteEntity,
      onRenameKeyDown,
      saveRename,
      setEditingTarget,
      sidebar.expandedFolderIds,
      sidebar.toggleFolder,
    ],
  );

  const initialQueriesState = getInitialQueriesState([
    pagesQuery,
    foldersQuery,
    favoritesQuery,
    recentsQuery,
    sharedNavigationQuery,
    workspaceMembershipsQuery,
  ]);

  if (initialQueriesState.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingIndicator label="Loading sidebar" />
      </div>
    );
  }

  if (isAnonymous) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
          <div className="px-3 py-4 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
              Sign in to access your pages
            </p>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (initialQueriesState.status === 'paused' || initialQueriesState.status === 'error') {
    return (
      <div
        role="alert"
        className="m-4 space-y-2 rounded-md border border-red-200 bg-zinc-100 p-3 text-sm text-red-500 dark:border-red-900/30 dark:bg-zinc-800/50"
      >
        <p>
          {initialQueriesState.status === 'paused'
            ? 'Navigation is paused. Check your connection.'
            : 'Failed to load navigation.'}
        </p>
        <button
          type="button"
          onClick={() => {
            void Promise.all([
              refetchPages(),
              refetchFolders(),
              refetchFavorites(),
              refetchRecents(),
              refetchSharedNavigation(),
              refetchWorkspaceMemberships(),
            ]);
          }}
          className="rounded border border-red-200 px-2 py-1 text-xs hover:bg-red-50 dark:border-red-900/40 dark:hover:bg-red-950/30 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const rootFolders = ownedFolders;
  const sharedPreview = directSharedNavigation.slice(0, SIDEBAR_PREVIEW_LIMIT);
  const hasMoreShared = directSharedNavigation.length > SIDEBAR_PREVIEW_LIMIT;
  const visibleWorkspaceGroups = workspaceGroups;
  const hasSharedContent = sharedPreview.length > 0 || visibleWorkspaceGroups.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-2 pt-2 pb-1">
        <div className="flex items-center justify-center gap-1">
          <label
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-all text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
            title="Import markdown file"
          >
            <input type="file" accept=".md" className="hidden" onChange={handleImportMarkdown} />
            <Download size={16} />
          </label>
          <button
            type="button"
            onClick={() => {
              void handleCreateRootFolder();
            }}
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-all text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
            title={`Create folder (${createFolderShortcut})`}
            data-testid="new-folder-btn"
          >
            <FolderPlus size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              void handleCreateRootPage();
            }}
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-all text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
            title={`Create note (${createNoteShortcut})`}
            data-testid="new-page-btn"
          >
            <FilePlus2 size={16} />
          </button>
          <button
            type="button"
            onClick={sidebar.toggleAll}
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-all text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
            title={sidebar.allExpanded ? 'Collapse all folders' : 'Expand all folders'}
            data-testid="toggle-expand-all-btn"
          >
            {sidebar.allExpanded ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        <SidebarAliasSection
          title="Favorites"
          collapsed={sidebar.collapsedSections.has('favorites')}
          onToggle={() => sidebar.toggleSection('favorites')}
          rows={favoriteRows}
          runtime={sidebarTreeRuntime}
        />
        <SidebarAliasSection
          title="Recents"
          collapsed={sidebar.collapsedSections.has('recents')}
          onToggle={() => sidebar.toggleSection('recents')}
          rows={recentRows}
          runtime={sidebarTreeRuntime}
        />

        {hasSharedContent && (
          <div className="mb-2">
            <button
              type="button"
              onClick={() => sidebar.toggleSection('shared')}
              aria-expanded={!sidebar.collapsedSections.has('shared')}
              className="flex items-center px-1 mb-2 text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors w-full text-left"
            >
              {sidebar.collapsedSections.has('shared') ? (
                <ChevronRight size={14} className="mr-1 shrink-0" />
              ) : (
                <ChevronDown size={14} className="mr-1 shrink-0" />
              )}
              <span>Shared With Me</span>
            </button>
            {!sidebar.collapsedSections.has('shared') && (
              <div className="space-y-1">
                {visibleWorkspaceGroups.map((group) => {
                  const isCollapsed = sidebar.collapsedWorkspaceIds.has(group.ownerId);
                  return (
                    <div key={`workspace-${group.ownerId}`}>
                      <div className="flex items-center gap-1 px-3 py-1">
                        <button
                          type="button"
                          onClick={() => sidebar.toggleWorkspace(group.ownerId)}
                          className="flex min-w-0 flex-1 items-center text-left text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
                        >
                          {isCollapsed ? (
                            <ChevronRight size={13} className="mr-1 shrink-0" />
                          ) : (
                            <ChevronDown size={13} className="mr-1 shrink-0" />
                          )}
                          <span className="truncate">
                            {group.ownerName
                              ? `${group.ownerName}'s Workspace`
                              : 'Shared Workspace'}
                          </span>
                        </button>
                        <button
                          type="button"
                          title="Leave workspace"
                          aria-label={`Leave ${group.ownerName ?? 'workspace'}`}
                          disabled={leaveWorkspaceMutation.isPending || !currentUserId}
                          onClick={() => {
                            if (!currentUserId) return;
                            leaveWorkspaceMutation.mutate({
                              ownerId: group.ownerId,
                              memberId: currentUserId,
                            });
                          }}
                          className="rounded p-1 text-zinc-400 hover:bg-black/5 hover:text-red-600 disabled:opacity-40 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <LogOut size={12} />
                        </button>
                      </div>
                      {!isCollapsed && (
                        <div className="space-y-0.5">
                          {group.folders.map((folder) => (
                            <WorkspaceFolderBranch
                              runtime={sidebarTreeRuntime}
                              key={folder.id}
                              folder={folder}
                              workspaceOwnerId={group.ownerId}
                              allPagesByFolder={allPagesByFolder}
                              sourceIsAdmin={group.role === 'admin'}
                            />
                          ))}
                          {group.pages.map((page) => (
                            <WorkspacePageRow
                              runtime={sidebarTreeRuntime}
                              key={page.id}
                              page={page}
                              sourceIsAdmin={group.role === 'admin'}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sharedPreview.map((item) => (
                  <SharedNavigationBranch
                    key={`${item.entityType}-${item.id}`}
                    item={item}
                    runtime={sidebarTreeRuntime}
                  />
                ))}
                {hasMoreShared && (
                  <button
                    type="button"
                    onClick={() => navigate(`${getWorkspacePath()}?filter=shared-with-me`)}
                    className="w-full px-4 py-1.5 text-left text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
                  >
                    View more
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => sidebar.toggleSection('owned')}
            aria-expanded={!sidebar.collapsedSections.has('owned')}
            className="flex items-center px-1 mb-2 text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors w-full text-left"
          >
            {sidebar.collapsedSections.has('owned') ? (
              <ChevronRight size={14} className="mr-1 shrink-0" />
            ) : (
              <ChevronDown size={14} className="mr-1 shrink-0" />
            )}
            <span>Owned By Me</span>
          </button>
          {!sidebar.collapsedSections.has('owned') && (
            <div className="space-y-0.5">
              {rootFolders.map((folder) => (
                <OwnedFolderBranch
                  runtime={sidebarTreeRuntime}
                  key={folder.id}
                  folder={folder}
                  foldersByParent={foldersByParent}
                  pagesByFolder={pagesByFolder}
                />
              ))}
              {rootPages.map((page) => (
                <SidebarEntityRow
                  runtime={sidebarTreeRuntime}
                  key={page.id}
                  entity={{
                    entityType: 'page',
                    id: page.id,
                    title: page.title,
                    icon: page.icon,
                    ownerId: page.ownerId,
                    createdBy: page.createdBy,
                    userPermission: page.userPermission,
                    parentId: page.parentId,
                  }}
                  placement="owned"
                />
              ))}
              {rootFolders.length === 0 && rootPages.length === 0 && (
                <div className="pl-10 pr-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                  No notes yet
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
