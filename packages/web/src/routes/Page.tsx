import type { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocketStatus } from '@hocuspocus/provider';
import {
  type CommentAnchor,
  deriveCapabilities,
  type Folder,
  type FolderTreeNode,
  type PageDetailPayload,
  type PageTreeNode,
  pageCommentThreadsResponseSchema,
  parsePageDetailPayload,
  type SharePermission,
} from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileQuestion, LogIn, RefreshCw, ShieldOff } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { AppShellToolbar, useAppShellOutletContext } from '../components/AppShellToolbar';
import { BacklinksPanel } from '../components/editor/BacklinksPanel';
import { Breadcrumbs } from '../components/editor/Breadcrumbs';
import { CodeMirrorEditor } from '../components/editor/CodeMirrorEditor';
import { CollabStatus } from '../components/editor/CollabStatus';
import { CommentsPanel } from '../components/editor/CommentsPanel';
import { PageActions } from '../components/editor/PageActions';
import { PageIcon } from '../components/editor/PageIcon';
import { PageLoadingState } from '../components/editor/PageLoadingState';
import { PageTitle } from '../components/editor/PageTitle';
import { PropertiesPanel } from '../components/editor/PropertiesPanel';
import { ThemeToggle } from '../components/ThemeToggle';
import { EditorReadOnlyProvider } from '../contexts/EditorReadOnlyContext';
import { useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import {
  useSetAccessPermission,
  useSetCapabilities,
  useShareContext,
} from '../contexts/ShareContext';
import type { WikiLinkNavigationTarget } from '../editor/wikiLinkPresentations';
import { useFolderTree } from '../hooks/use-folders';
import { usePageCollaborators } from '../hooks/use-page-collaborators';
import { type RecentPage, usePageTree } from '../hooks/use-pages';
import { usePageFullWidth } from '../hooks/usePageFullWidth';
import { getLogger } from '../logger-init';
import { ApiError, apiFetch } from '../utils/api';
import { getApplicationFaviconHref, resetDocumentMetadata } from '../utils/documentMeta';
import { getHeadingId } from '../utils/headingNavigation';
import {
  createPageComment,
  invalidatePageCommentQueries,
  pageCommentHighlightsQueryKey,
} from '../utils/pageCommentMutations';
import {
  buildFolderPath,
  buildPagePath,
  extractUuidFromSlug,
  getWorkspacePath,
  getWorkspacePathPrefix,
} from '../utils/url';
import { styles } from './Page.stylex';
import './Page.layout.css';

const API_BASE = '/api';
const COMMENTS_OPEN_STORAGE_KEY = 'metakip-comments-open';
// Minimum content width for a 640px editor beside the comments panel and gutters.
const COMMENTS_DOCK_MIN_WIDTH = 1022;

function getSavedCommentsOpen(): boolean {
  try {
    return localStorage.getItem(COMMENTS_OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveCommentsOpen(open: boolean): void {
  try {
    localStorage.setItem(COMMENTS_OPEN_STORAGE_KEY, String(open));
  } catch {}
}

async function fetchPage(pageId: string): Promise<PageDetailPayload> {
  const res = await fetch(`${API_BASE}/pages/${pageId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : 'Failed to fetch page';
    throw new ApiError(res.status, message);
  }
  const payload: unknown = await res.json();
  return parsePageDetailPayload(payload);
}

export default function Page() {
  const { slugAndId } = useParams<{ slugAndId: string }>();
  const location = useLocation();
  const { contentContainer, isDesktopLayout } = useAppShellOutletContext();
  const pageId = slugAndId ? extractUuidFromSlug(slugAndId) : undefined;
  const navigate = useIdentityNavigate();
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [collabStatus, setCollabStatus] = useState<WebSocketStatus>(WebSocketStatus.Connecting);
  const [collabPermission, setCollabPermission] = useState<SharePermission | null | undefined>(
    undefined,
  );
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [isCommentsDocked, setIsCommentsDocked] = useState(false);
  const [pendingCommentSelection, setPendingCommentSelection] = useState(false);
  const [selectedCommentAnchor, setSelectedCommentAnchor] = useState<CommentAnchor | null>(null);
  const [activeCommentAnchor, setActiveCommentAnchor] = useState<CommentAnchor | null>(null);
  const accessRecordedRef = useRef<string | null>(null);
  const prevPageIdRef = useRef<string | undefined>(pageId);
  const isCommentsDockedRef = useRef(false);
  const hasMeasuredCommentsDockRef = useRef(false);
  const queryClient = useQueryClient();
  const { isAnonymous, accessPermission } = useShareContext();
  const { fullWidth, toggleFullWidth } = usePageFullWidth(pageId);
  const wideModeActive = fullWidth && !isAnonymous;
  const setAccessPermission = useSetAccessPermission();
  const setCapabilities = useSetCapabilities();

  // Clear state on page navigation, but not while the initial page ID resolves.
  useEffect(() => {
    const prevPageId = prevPageIdRef.current;
    prevPageIdRef.current = pageId;
    if (prevPageId === undefined || prevPageId === pageId) return;

    // Don't reset provider here — CodeMirrorEditor manages its own lifecycle.
    // This effect runs AFTER CodeMirrorEditor's onProviderReady (child effects
    // fire first), so setProvider(null) would overwrite the new provider.
    setCollabStatus(WebSocketStatus.Connecting);
    setCollabPermission(undefined);
    setPendingCommentSelection(false);
    if (!isCommentsDockedRef.current) setCommentsOpen(false);
    setSelectedCommentAnchor(null);
    setActiveCommentAnchor(null);
  }, [pageId]);

  useLayoutEffect(() => {
    if (!contentContainer) return;

    const updateDocking = () => {
      const isDocked = contentContainer.clientWidth >= COMMENTS_DOCK_MIN_WIDTH;
      if (isDocked !== isCommentsDockedRef.current) {
        isCommentsDockedRef.current = isDocked;
        setIsCommentsDocked(isDocked);
      }
      if (!hasMeasuredCommentsDockRef.current) {
        hasMeasuredCommentsDockRef.current = true;
        if (isDocked) setCommentsOpen(getSavedCommentsOpen());
      }
    };

    updateDocking();
    const observer = new ResizeObserver(updateDocking);
    observer.observe(contentContainer);
    return () => observer.disconnect();
  }, [contentContainer]);

  const {
    data: page,
    error,
    refetch: refetchPage,
  } = useQuery({
    queryKey: ['pages', 'detail', pageId],
    queryFn: () => {
      if (!pageId) throw new Error('pageId is required');
      return fetchPage(pageId);
    },
    enabled: !!pageId,
    retry: false,
  });
  const handlePageDeleted = useCallback(() => {
    const parentId = page?.accessScope === 'account' ? page.parentId : null;
    navigate(parentId ? buildFolderPath('folder', parentId) : getWorkspacePath(), {
      replace: true,
    });
  }, [navigate, page]);
  const { data: collaboratorsByPage } = usePageCollaborators(
    !isAnonymous && pageId ? [pageId] : [],
  );
  const pageCollaborators = pageId ? (collaboratorsByPage?.[pageId] ?? []) : [];

  const handleDocumentReloadRequired = useCallback(() => {
    setProvider(null);
    setCollabStatus(WebSocketStatus.Connecting);
    setCollabPermission(undefined);
    queryClient.invalidateQueries({ queryKey: ['backlinks'] });
    void refetchPage();
    setEditorGeneration((generation) => generation + 1);
  }, [queryClient, refetchPage]);

  const pagePermission =
    collabPermission !== undefined ? collabPermission : (page?.userPermission ?? accessPermission);
  const contextAccessPermission = pagePermission === 'admin' ? 'edit' : pagePermission;
  const effectiveCapabilities = useMemo(
    () =>
      collabPermission === undefined
        ? deriveCapabilities(null)
        : deriveCapabilities(collabPermission),
    [collabPermission],
  );
  const readOnly = collabPermission === undefined || !effectiveCapabilities.canEdit;
  const canLoadComments =
    !!pageId && !isAnonymous && effectiveCapabilities.canComment && collabPermission !== undefined;
  const commentsPanelVisible = commentsOpen && canLoadComments;
  const commentsPanelDocked = commentsPanelVisible && isCommentsDocked;
  useEffect(() => {
    if (collabPermission === undefined || effectiveCapabilities.canComment) return;
    setSelectedCommentAnchor(null);
    setActiveCommentAnchor(null);
  }, [collabPermission, effectiveCapabilities.canComment]);
  const commentsQuery = useInfiniteQuery({
    queryKey: pageCommentHighlightsQueryKey(pageId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ status: 'open', limit: '100' });
      if (pageParam) params.set('cursor', pageParam);
      return pageCommentThreadsResponseSchema.parse(
        await apiFetch<unknown>(`/v1/pages/${pageId}/comments?${params.toString()}`),
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: canLoadComments,
    staleTime: 15_000,
  });
  useEffect(() => {
    if (
      !commentsQuery.isFetchNextPageError ||
      !(commentsQuery.error instanceof ApiError) ||
      commentsQuery.error.status !== 409
    ) {
      return;
    }
    void queryClient.resetQueries({
      queryKey: pageCommentHighlightsQueryKey(pageId),
      exact: true,
    });
  }, [commentsQuery.error, commentsQuery.isFetchNextPageError, pageId, queryClient]);
  useEffect(() => {
    if (
      !canLoadComments ||
      !commentsQuery.hasNextPage ||
      commentsQuery.isFetching ||
      commentsQuery.isFetchNextPageError
    ) {
      return;
    }
    void commentsQuery.fetchNextPage({ cancelRefetch: false });
  }, [
    canLoadComments,
    commentsQuery.fetchNextPage,
    commentsQuery.hasNextPage,
    commentsQuery.isFetchNextPageError,
    commentsQuery.isFetching,
  ]);
  const commentThreads = useMemo(
    () => (canLoadComments ? (commentsQuery.data?.pages.flatMap((page) => page.data) ?? []) : []),
    [canLoadComments, commentsQuery.data?.pages],
  );
  const showInlineCommentRail =
    !commentsPanelVisible && commentThreads.some((thread) => thread.comments.length > 0);
  const commentAnchors = useMemo(
    () => [
      ...commentThreads.map((thread) => thread.anchor),
      ...(commentsPanelVisible && selectedCommentAnchor ? [selectedCommentAnchor] : []),
      ...(activeCommentAnchor ? [activeCommentAnchor] : []),
    ],
    [activeCommentAnchor, commentThreads, commentsPanelVisible, selectedCommentAnchor],
  );
  useEffect(() => {
    if (!page) return;
    setAccessPermission(contextAccessPermission);
    setCapabilities(effectiveCapabilities);
  }, [page, contextAccessPermission, effectiveCapabilities, setAccessPermission, setCapabilities]);

  const requestedHeadingId = useMemo(() => {
    if (!location.hash) return undefined;
    try {
      return decodeURIComponent(location.hash.slice(1)) || undefined;
    } catch {
      return undefined;
    }
  }, [location.hash]);

  useEffect(() => {
    if (!page || page.accessScope !== 'account' || !pageId || isAnonymous) {
      return;
    }
    if (accessRecordedRef.current === pageId) {
      return;
    }
    accessRecordedRef.current = pageId;

    const visitedAt = new Date().toISOString();
    queryClient.setQueriesData<RecentPage[]>({ queryKey: ['pages', 'recent'] }, (old) => {
      if (!old) return old;
      const next: RecentPage[] = [
        {
          id: page.id,
          title: page.title,
          icon: page.icon,
          createdBy: page.createdBy,
          ownerId: page.ownerId ?? null,
          updatedAt: page.updatedAt ?? page.createdAt ?? visitedAt,
          visitedAt,
        },
        ...old.filter((recentPage) => recentPage.id !== page.id),
      ];
      return next.slice(0, old.length);
    });

    let cancelled = false;
    let retryTimer: number | undefined;
    const recordAccess = async (attempt = 0): Promise<void> => {
      try {
        const res = await fetch(`/api/pages/${pageId}/access`, {
          method: 'POST',
        });
        if (!res.ok) {
          throw new Error(`Failed to record page access (${res.status})`);
        }
        if (cancelled) return;
        await res.json();
        if (cancelled) return;
        // A signed-in public visit belongs in Shared With Me even when a
        // stronger account grant currently wins.
        queryClient.invalidateQueries({ queryKey: ['pageTree'] });
        queryClient.invalidateQueries({ queryKey: ['folderTree'] });
        queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
        queryClient.invalidateQueries({ queryKey: ['pages', 'recent'] });
      } catch (error) {
        if (cancelled) return;
        if (attempt < 1) {
          retryTimer = window.setTimeout(() => void recordAccess(attempt + 1), 1000);
          return;
        }
        try {
          getLogger().error('Failed to record page access after retry', {
            error: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // Logging must not interrupt page loading when the logger is unavailable.
        }
      }
    };

    void recordAccess();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [page, pageId, isAnonymous, queryClient]);

  const handleStatusChange = (newStatus: WebSocketStatus) => {
    setCollabStatus(newStatus);
    if (newStatus !== WebSocketStatus.Connected) {
      setCollabPermission(undefined);
    }
  };

  const updateDocumentMeta = useCallback(() => {
    if (!page) return;

    document.title = `${page.title} | Metakip`;

    const existingLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const icon = page.icon;

    if (icon && icon.trim().length > 0) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="28" font-size="28">${icon}</text></svg>`;
      const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      if (existingLink) {
        existingLink.href = dataUrl;
      }
    } else if (existingLink) {
      existingLink.href = getApplicationFaviconHref();
    }

    let canonicalLink = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.rel = 'canonical';
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = `${window.location.origin}${buildPagePath(page.title, page.id)}`;
  }, [page]);

  useEffect(() => {
    updateDocumentMeta();
    return resetDocumentMetadata;
  }, [updateDocumentMeta]);

  useEffect(() => {
    if (!page || !slugAndId) return;
    const expectedPath = buildPagePath(page.title, page.id).slice(getWorkspacePathPrefix().length);

    if (slugAndId !== expectedPath) {
      const canonicalUrl = new URL(window.location.href);
      canonicalUrl.pathname = canonicalUrl.pathname.replace(/\/[^/]+$/, `/${expectedPath}`);
      window.history.replaceState(null, '', canonicalUrl);
    }
  }, [page, slugAndId]);

  const { data: pageTree } = usePageTree({ enabled: !isAnonymous });
  const { data: folderTree } = useFolderTree({ enabled: !isAnonymous });

  const flatPages = useMemo(() => {
    if (isAnonymous) return [];
    const result: Pick<PageTreeNode, 'id' | 'parentId' | 'title'>[] = [];
    const visit = (nodes: PageTreeNode[] | undefined) => {
      if (!nodes) return;
      for (const node of nodes) {
        result.push(node);
        if (node.children && node.children.length > 0) {
          visit(node.children);
        }
      }
    };
    visit(pageTree as PageTreeNode[] | undefined);
    if (page?.accessScope === 'account' && !result.some((item) => item.id === page.id)) {
      result.push(page);
    }
    return result;
  }, [pageTree, page, isAnonymous]);

  const flatFolders = useMemo(() => {
    if (isAnonymous) return [];
    const result: Folder[] = [];
    const visit = (nodes: FolderTreeNode[] | undefined) => {
      if (!nodes) return;
      for (const node of nodes) {
        const { children, ...folder } = node as FolderTreeNode & { children?: FolderTreeNode[] };
        result.push(folder);
        if (children && children.length > 0) {
          visit(children);
        }
      }
    };
    visit(folderTree as FolderTreeNode[] | undefined);
    return result;
  }, [folderTree, isAnonymous]);

  const handleWikiLinkClick = useCallback(
    (target: WikiLinkNavigationTarget) => {
      const path = buildPagePath(target.title, target.id);
      const headingId = target.heading ? getHeadingId(target.heading) : '';
      navigate(headingId ? `${path}#${encodeURIComponent(headingId)}` : path);
    },
    [navigate],
  );

  const setCommentsPanelOpen = (open: boolean) => {
    setCommentsOpen(open);
    if (isCommentsDocked) saveCommentsOpen(open);
  };
  const openComments = (anchor: CommentAnchor | null = selectedCommentAnchor) => {
    setSelectedCommentAnchor(anchor);
    setPendingCommentSelection(false);
    setCommentsPanelOpen(true);
  };
  const closeComments = () => {
    setActiveCommentAnchor(null);
    setPendingCommentSelection(false);
    setCommentsPanelOpen(false);
  };
  const startCommentSelection = () => {
    setPendingCommentSelection(true);
    setActiveCommentAnchor(null);
    setCommentsOpen(false);
  };
  const handleCommentSelection = (anchor: CommentAnchor | null) => {
    setSelectedCommentAnchor(anchor);
    if (anchor && pendingCommentSelection) {
      setPendingCommentSelection(false);
      setCommentsPanelOpen(true);
    }
  };

  const createInlineComment = useCallback(
    async (anchor: CommentAnchor, body: string) => {
      if (!pageId) throw new Error('Page is not available');
      await createPageComment(pageId, body, anchor);
      await invalidatePageCommentQueries(queryClient, pageId);
    },
    [pageId, queryClient],
  );

  if (!pageId) {
    return <div {...stylex.props(styles.notFoundContainer)}>Page not found.</div>;
  }

  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <div {...stylex.props(styles.errorContainer)}>
          <div {...stylex.props(styles.accessErrorState)}>
            <ShieldOff size={48} {...stylex.props(styles.errorIcon)} />
            <h2 {...stylex.props(styles.errorTitle)}>You don&apos;t have access</h2>
            <p {...stylex.props(styles.errorDescription)}>
              Your access to this page may have been removed. Contact the page owner to request
              access.
            </p>
          </div>
        </div>
      );
    }
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div {...stylex.props(styles.errorContainer)}>
          <div {...stylex.props(styles.errorState)}>
            <FileQuestion size={48} {...stylex.props(styles.errorIcon)} />
            <h2 {...stylex.props(styles.errorTitle)}>Page not found</h2>
            <p {...stylex.props(styles.errorDescription)}>It may have been deleted.</p>
          </div>
        </div>
      );
    }
    return (
      <div {...stylex.props(styles.errorContainer)}>
        <div {...stylex.props(styles.errorState)}>
          <FileQuestion size={48} {...stylex.props(styles.errorIcon)} />
          <h2 {...stylex.props(styles.errorTitle)}>Couldn&apos;t load this page</h2>
          <p {...stylex.props(styles.errorDescription)}>
            The server returned an error. Your page has not been changed.
          </p>
          <button
            type="button"
            onClick={() => void refetchPage()}
            {...stylex.props(styles.retryButton)}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!page) {
    return (
      <div {...stylex.props(styles.loadingState)}>
        <PageLoadingState />
      </div>
    );
  }

  return (
    <EditorReadOnlyProvider readOnly={readOnly}>
      <div
        {...stylex.props(styles.pageLayout)}
        data-page-layout-root=""
        data-page-layout={wideModeActive ? 'wide' : 'default'}
      >
        <AppShellToolbar>
          <div {...stylex.props(styles.toolbarContent)}>
            {isAnonymous ? (
              <button
                type="button"
                onClick={() => navigate('/login')}
                {...stylex.props(styles.signInButton)}
              >
                <LogIn size={16} />
                Sign in
              </button>
            ) : (
              <div {...stylex.props(styles.breadcrumbContainer)}>
                <Breadcrumbs pages={flatPages} folders={flatFolders} currentPageId={pageId} />
              </div>
            )}
            <div {...stylex.props(styles.toolbarActions)}>
              {collabPermission === 'view' && !effectiveCapabilities.canEdit && (
                <span {...stylex.props(styles.permissionPill, styles.permissionPillView)}>
                  View Access
                </span>
              )}
              {collabPermission === 'commenter' && (
                <span {...stylex.props(styles.permissionPill, styles.permissionPillCommenter)}>
                  Comment Access
                </span>
              )}
              {!isAnonymous && (
                <PageActions
                  isDesktopLayout={isDesktopLayout}
                  key={pageId}
                  page={page}
                  permission={pagePermission}
                  onDeleted={handlePageDeleted}
                  fullWidth={fullWidth}
                  onToggleFullWidth={toggleFullWidth}
                  canComment={effectiveCapabilities.canComment}
                  commentsOpen={commentsPanelVisible}
                  commentsCount={commentThreads.length}
                  onToggleComments={() => {
                    if (commentsOpen) closeComments();
                    else openComments();
                  }}
                />
              )}
              {isAnonymous && <ThemeToggle />}
              <CollabStatus
                provider={provider}
                status={collabStatus}
                collaborators={pageCollaborators}
              />
            </div>
          </div>
        </AppShellToolbar>

        <div
          data-page-editor-container=""
          data-comments-docked={commentsPanelDocked ? 'true' : 'false'}
        >
          <main
            {...stylex.props(styles.editorContent)}
            data-page-editor-content=""
            data-comment-rail={showInlineCommentRail ? '' : undefined}
            data-testid="page-editor-content"
          >
            <div {...stylex.props(styles.pageHeading)}>
              <div {...stylex.props(styles.pageHeadingRow)}>
                <div {...stylex.props(styles.pageIconContainer)}>
                  <EditorReadOnlyProvider readOnly={readOnly}>
                    <PageIcon pageId={pageId} initialIcon={page?.icon ?? null} />
                  </EditorReadOnlyProvider>
                </div>
                <div {...stylex.props(styles.pageTitleContainer)}>
                  <PageTitle
                    pageId={pageId}
                    initialTitle={page?.title ?? 'Untitled'}
                    ydoc={provider?.document ?? null}
                    usePublicEndpoint={isAnonymous}
                  />
                </div>
              </div>
            </div>
            <EditorReadOnlyProvider readOnly={readOnly}>
              <PropertiesPanel pageId={pageId} properties={page?.properties ?? null} />
            </EditorReadOnlyProvider>
            <CodeMirrorEditor
              key={`${pageId}:${editorGeneration}`}
              pageId={pageId}
              onDocumentReloadRequired={handleDocumentReloadRequired}
              onProviderReady={setProvider}
              onStatusChange={handleStatusChange}
              onWikiLinkClick={handleWikiLinkClick}
              onPermissionSnapshot={setCollabPermission}
              commentAnchors={commentAnchors}
              commentThreads={commentThreads}
              hideInlineCommentCards={!showInlineCommentRail}
              hideTableOfContents={commentsPanelDocked}
              activeCommentAnchor={activeCommentAnchor}
              onCommentAnchorHoverChange={setActiveCommentAnchor}
              canComment={effectiveCapabilities.canComment && !isAnonymous}
              canModerateComments={page.capabilities.canDelete}
              onCommentSelection={handleCommentSelection}
              onCreateComment={createInlineComment}
              {...(requestedHeadingId ? { requestedHeadingId } : {})}
            />
            {!isAnonymous && <BacklinksPanel pageId={pageId} />}
          </main>
          {commentsPanelVisible && (
            <CommentsPanel
              pageId={pageId}
              isDrawer={!commentsPanelDocked}
              selectedAnchor={selectedCommentAnchor}
              canModerate={page.capabilities.canDelete}
              onStartSelection={startCommentSelection}
              activeCommentAnchor={activeCommentAnchor}
              onCommentAnchorHoverChange={setActiveCommentAnchor}
              onClose={closeComments}
              onClearSelection={() => setSelectedCommentAnchor(null)}
            />
          )}
        </div>
      </div>
    </EditorReadOnlyProvider>
  );
}
