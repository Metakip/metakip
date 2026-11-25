import * as stylex from '@stylexjs/stylex';
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
import { useFolderTree, useUpdateFolder } from '../../hooks/use-folders';
import {
  useImportMarkdown,
  usePageTree,
  useRecentPages,
  useUpdatePage,
} from '../../hooks/use-pages';
import { useSharedWithMeTree } from '../../hooks/use-shared-with-me';
import { useStars } from '../../hooks/use-stars';
import { useLeaveWorkspace, useWorkspaceMemberships } from '../../hooks/use-workspace';
import { useAuth } from '../../hooks/useAuth';
import { useEntityCreationActions } from '../../hooks/useEntityCreationActions';
import { useStableValueWhile } from '../../hooks/useStableValue';
import { formatShortcut, SHORTCUT_PATTERNS } from '../../utils/keyboardShortcuts';
import { getInitialQueriesState } from '../../utils/queryState';
import { showErrorToast } from '../../utils/toast';
import { buildPagePath, extractUuidFromSlug, getWorkspacePath } from '../../utils/url';
import { actionColors } from '../ui/ActionColors.stylex';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { styles } from './PageTree.stylex';
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
  const starsQuery = useStars();
  const { data: refreshedStars, refetch: refetchStars } = starsQuery;
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
  const stars = useStableValueWhile(refreshedStars, isBulkRemovalPending);
  const recentPages = useStableValueWhile(refreshedRecentPages, isBulkRemovalPending);
  const sharedNavigation = useStableValueWhile(refreshedSharedNavigation, isBulkRemovalPending);
  const workspaceMemberships = useStableValueWhile(
    refreshedWorkspaceMemberships,
    isBulkRemovalPending,
  );

  const starKeys = useMemo(
    () => new Set(stars?.map((star) => `${star.entityType}:${star.entityId}`) ?? []),
    [stars],
  );
  const isStarredEntity = useCallback(
    (entityType: 'folder' | 'page', entityId: string) => starKeys.has(`${entityType}:${entityId}`),
    [starKeys],
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
    starredRows,
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
    stars: stars ?? [],
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
      isStarredEntity,
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
      isStarredEntity,
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
    starsQuery,
    recentsQuery,
    sharedNavigationQuery,
    workspaceMembershipsQuery,
  ]);

  if (initialQueriesState.status === 'loading') {
    return (
      <div {...stylex.props(styles.loadingState)}>
        <LoadingIndicator label="Loading sidebar" />
      </div>
    );
  }

  if (isAnonymous) {
    return (
      <div {...stylex.props(styles.layout)}>
        <div {...stylex.props(styles.content)}>
          <div {...stylex.props(styles.signInCard)}>
            <p {...stylex.props(styles.signInDescription)}>Sign in to access your pages</p>
            <button
              type="button"
              onClick={() => navigate('/login')}
              {...stylex.props(actionColors.contrast, styles.signInButton)}
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
      <div role="alert" {...stylex.props(styles.errorState)}>
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
              refetchStars(),
              refetchRecents(),
              refetchSharedNavigation(),
              refetchWorkspaceMemberships(),
            ]);
          }}
          {...stylex.props(styles.retryButton)}
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
    <div {...stylex.props(styles.layout)}>
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.toolbarButtons)}>
          <label {...stylex.props(styles.toolbarButton)} title="Import markdown file">
            <input
              type="file"
              accept=".md"
              {...stylex.props(styles.hiddenInput)}
              onChange={handleImportMarkdown}
            />
            <Download size={16} />
          </label>
          <button
            type="button"
            onClick={() => {
              void handleCreateRootFolder();
            }}
            {...stylex.props(styles.toolbarButton)}
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
            {...stylex.props(styles.toolbarButton)}
            title={`Create note (${createNoteShortcut})`}
            data-testid="new-page-btn"
          >
            <FilePlus2 size={16} />
          </button>
          <button
            type="button"
            onClick={sidebar.toggleAll}
            {...stylex.props(styles.toolbarButton)}
            title={sidebar.allExpanded ? 'Collapse all folders' : 'Expand all folders'}
            data-testid="toggle-expand-all-btn"
          >
            {sidebar.allExpanded ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
          </button>
        </div>
      </div>

      <div {...stylex.props(styles.content)}>
        <SidebarAliasSection
          title="Starred"
          collapsed={sidebar.collapsedSections.has('starred')}
          onToggle={() => sidebar.toggleSection('starred')}
          rows={starredRows}
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
          <div {...stylex.props(styles.sharedSection)}>
            <button
              type="button"
              onClick={() => sidebar.toggleSection('shared')}
              aria-expanded={!sidebar.collapsedSections.has('shared')}
              {...stylex.props(styles.sectionToggle)}
            >
              {sidebar.collapsedSections.has('shared') ? (
                <ChevronRight size={14} {...stylex.props(styles.sectionChevron)} />
              ) : (
                <ChevronDown size={14} {...stylex.props(styles.sectionChevron)} />
              )}
              <span>Shared With Me</span>
            </button>
            {!sidebar.collapsedSections.has('shared') && (
              <div {...stylex.props(styles.sidebarList)}>
                {visibleWorkspaceGroups.map((group) => {
                  const isCollapsed = sidebar.collapsedWorkspaceIds.has(group.ownerId);
                  return (
                    <div key={`workspace-${group.ownerId}`}>
                      <div {...stylex.props(styles.workspaceHeader)}>
                        <button
                          type="button"
                          onClick={() => sidebar.toggleWorkspace(group.ownerId)}
                          {...stylex.props(styles.workspaceButton)}
                        >
                          {isCollapsed ? (
                            <ChevronRight size={13} {...stylex.props(styles.workspaceChevron)} />
                          ) : (
                            <ChevronDown size={13} {...stylex.props(styles.workspaceChevron)} />
                          )}
                          <span {...stylex.props(styles.workspaceName)}>
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
                          {...stylex.props(styles.leaveWorkspaceButton)}
                        >
                          <LogOut size={12} />
                        </button>
                      </div>
                      {!isCollapsed && (
                        <div {...stylex.props(styles.workspaceItems)}>
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
                    {...stylex.props(styles.viewMoreButton)}
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
            {...stylex.props(styles.sectionToggle)}
          >
            {sidebar.collapsedSections.has('owned') ? (
              <ChevronRight size={14} {...stylex.props(styles.sectionChevron)} />
            ) : (
              <ChevronDown size={14} {...stylex.props(styles.sectionChevron)} />
            )}
            <span>Owned By Me</span>
          </button>
          {!sidebar.collapsedSections.has('owned') && (
            <div {...stylex.props(styles.workspaceItems)}>
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
                <div {...stylex.props(styles.noNotes)}>No notes yet</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
