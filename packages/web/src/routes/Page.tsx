import type { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocketStatus } from '@hocuspocus/provider';
import {
  deriveCapabilities,
  type Folder,
  type FolderTreeNode,
  type PageDetailPayload,
  type PageTreeNode,
  parsePageDetailPayload,
  type SharePermission,
} from '@markdawn/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileQuestion, LogIn, RefreshCw, ShieldOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { BacklinksPanel } from '../components/editor/BacklinksPanel';
import { Breadcrumbs } from '../components/editor/Breadcrumbs';
import { MilkdownEditor } from '../components/editor/MilkdownEditor';
import { PageActions } from '../components/editor/PageActions';
import { PageIcon } from '../components/editor/PageIcon';
import { PageLoadingState } from '../components/editor/PageLoadingState';
import { PageStatus } from '../components/editor/PageStatus';
import { PageTitle } from '../components/editor/PageTitle';
import { PropertiesPanel } from '../components/editor/PropertiesPanel';
import { TableOfContents } from '../components/editor/TableOfContents';
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
import { type RecentPage, usePageTree } from '../hooks/use-pages';
import { getLogger } from '../logger-init';
import { ApiError } from '../utils/api';
import { resetDocumentMetadata } from '../utils/documentMeta';
import { findRenderedHeading, getMilkdownHeadingId } from '../utils/headingNavigation';
import { buildPagePath, extractUuidFromSlug, getWorkspacePathPrefix } from '../utils/url';

const API_BASE = '/api';

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
  const pageId = slugAndId ? extractUuidFromSlug(slugAndId) : undefined;
  const navigate = useIdentityNavigate();
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [collabStatus, setCollabStatus] = useState<WebSocketStatus>(WebSocketStatus.Connecting);
  const [collabPermission, setCollabPermission] = useState<SharePermission | null | undefined>(
    undefined,
  );
  const [editorGeneration, setEditorGeneration] = useState(0);
  const accessRecordedRef = useRef<string | null>(null);
  const isFirstMount = useRef(true);
  const prevPageIdRef = useRef<string | undefined>(pageId);
  const queryClient = useQueryClient();
  const { isAnonymous, accessPermission } = useShareContext();
  const setAccessPermission = useSetAccessPermission();
  const setCapabilities = useSetCapabilities();

  // Clear state on page navigation.
  // Skip when pageId transitions from undefined → UUID (initialization, not navigation)
  // and skip on the very first mount.
  useEffect(() => {
    const prevPageId = prevPageIdRef.current;

    if (isFirstMount.current) {
      isFirstMount.current = false;
      prevPageIdRef.current = pageId;
      return;
    }

    if (prevPageId === undefined && pageId !== undefined) {
      prevPageIdRef.current = pageId;
      return;
    }

    prevPageIdRef.current = pageId;
    // Don't reset provider here — MilkdownEditor manages its own lifecycle.
    // This effect runs AFTER MilkdownEditor's onProviderReady (child effects
    // fire first), so setProvider(null) would overwrite the new provider.
    setCollabStatus(WebSocketStatus.Connecting);
    setCollabPermission(undefined);
    setEditorElement(null);
  }, [pageId]);
  const [editorElement, setEditorElement] = useState<HTMLElement | null>(null);

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
  const readOnly =
    collabPermission === undefined || pagePermission === null || pagePermission === 'view';
  useEffect(() => {
    if (!page) return;
    setAccessPermission(contextAccessPermission);
    setCapabilities(effectiveCapabilities);
  }, [page, contextAccessPermission, effectiveCapabilities, setAccessPermission, setCapabilities]);

  // Find the .milkdown-editor DOM element for TableOfContents.
  // Re-runs on page change (data load or navigation) to handle the
  // editor mounting asynchronously after page fetch completes.
  // Polls up to 4 times (0ms, 200ms, 600ms, 1400ms) to catch the
  // editor regardless of page load timing.
  useEffect(() => {
    if (!page) return;
    let attempts = 0;
    const maxAttempts = 4;
    let id: ReturnType<typeof setTimeout>;

    const poll = () => {
      const el = document.querySelector('.milkdown-editor') as HTMLElement | null;
      if (el) {
        setEditorElement(el);
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        id = setTimeout(poll, attempts * 200);
      }
    };
    poll();
    return () => clearTimeout(id);
  }, [page]);

  useEffect(() => {
    if (!editorElement || !location.hash) return;
    let headingId: string;
    try {
      headingId = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    if (!headingId) return;

    const scrollToHeading = (): boolean => {
      const heading = findRenderedHeading(editorElement, headingId);
      if (!heading) return false;
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return true;
    };
    if (scrollToHeading()) return;

    const observer = new MutationObserver(() => {
      if (scrollToHeading()) observer.disconnect();
    });
    observer.observe(editorElement, { childList: true, subtree: true, attributes: true });
    const timeout = window.setTimeout(() => observer.disconnect(), 5_000);
    return () => {
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [editorElement, location.hash]);

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

    document.title = `${page.title} | Markdawn`;

    const existingLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const icon = page.icon;

    if (icon && icon.trim().length > 0) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="28" font-size="28">${icon}</text></svg>`;
      const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      if (existingLink) {
        existingLink.href = dataUrl;
      }
    } else if (existingLink) {
      existingLink.href = '/vite.svg';
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
      const headingId = target.heading ? getMilkdownHeadingId(target.heading) : '';
      navigate(headingId ? `${path}#${encodeURIComponent(headingId)}` : path);
    },
    [navigate],
  );

  if (!pageId) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 md:py-12 text-zinc-400 animate-fade-in">
        Page not found.
      </div>
    );
  }

  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <div className="max-w-4xl mx-auto px-6 py-8 md:py-12 animate-fade-in">
          <div className="flex flex-col items-center gap-4 text-center py-16">
            <ShieldOff size={48} className="text-zinc-300 dark:text-zinc-600" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              You don&apos;t have access
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Your access to this page may have been removed. Contact the page owner to request
              access.
            </p>
          </div>
        </div>
      );
    }
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="mx-auto max-w-4xl px-6 py-8 md:py-12 animate-fade-in">
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <FileQuestion size={48} className="text-zinc-300 dark:text-zinc-600" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Page not found
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">It may have been deleted.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 md:py-12 animate-fade-in">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <FileQuestion size={48} className="text-zinc-300 dark:text-zinc-600" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Couldn&apos;t load this page
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            The server returned an error. Your page has not been changed.
          </p>
          <button
            type="button"
            onClick={() => void refetchPage()}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-zinc-400 animate-fade-in">
        <PageLoadingState />
      </div>
    );
  }

  return (
    <EditorReadOnlyProvider readOnly={readOnly}>
      <div className="writer-layout mx-auto w-full max-w-[82rem] animate-fade-in">
        <div className="writer-toolbar sticky top-0 z-10 -mx-3 px-3 py-2 md:-mt-12">
          <div className="flex items-center justify-between text-sm font-medium text-zinc-500 dark:text-zinc-400 md:pt-5">
            {isAnonymous ? (
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              >
                <LogIn size={14} />
                Sign in
              </button>
            ) : (
              <div>
                <Breadcrumbs pages={flatPages} folders={flatFolders} currentPageId={pageId} />
              </div>
            )}
            <div className="flex items-center gap-2">
              {collabPermission === 'view' && !effectiveCapabilities.canEdit && (
                <span className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-full">
                  View only
                </span>
              )}
              {!isAnonymous && <PageActions pageId={pageId} page={page} />}
              {isAnonymous && <ThemeToggle />}
              <PageStatus provider={provider} collabStatus={collabStatus} />
            </div>
          </div>
        </div>

        <div className="writer-document-header mb-8 pt-16">
          <div className="relative flex flex-1 items-center">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center justify-center w-[42px] h-[42px]">
              <EditorReadOnlyProvider readOnly={readOnly}>
                <PageIcon pageId={pageId} initialIcon={page?.icon ?? null} />
              </EditorReadOnlyProvider>
            </div>
            <div className="pl-[54px] w-full">
              <PageTitle
                pageId={pageId}
                initialTitle={page?.title ?? 'Untitled'}
                ydoc={provider?.document ?? null}
                usePublicEndpoint={isAnonymous}
              />
            </div>
          </div>
          <EditorReadOnlyProvider readOnly={readOnly}>
            <PropertiesPanel pageId={pageId} properties={page?.properties ?? null} />
          </EditorReadOnlyProvider>
        </div>
        <div className="writer-document-content">
          {page && pageId ? (
            <MilkdownEditor
              key={`${pageId}:${editorGeneration}`}
              pageId={pageId}
              onDocumentReloadRequired={handleDocumentReloadRequired}
              onProviderReady={setProvider}
              onStatusChange={handleStatusChange}
              onWikiLinkClick={handleWikiLinkClick}
              onPermissionSnapshot={setCollabPermission}
            />
          ) : null}
          {!isAnonymous && <BacklinksPanel pageId={pageId} />}
        </div>
        <TableOfContents editorElement={editorElement} />
      </div>
    </EditorReadOnlyProvider>
  );
}
