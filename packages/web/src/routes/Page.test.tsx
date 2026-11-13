import { WebSocketStatus } from '@hocuspocus/provider';
import type { CapabilitySet } from '@metakip/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppShellContentState } from '../components/AppShell';
import { ClipboardProvider } from '../contexts/ClipboardContext';
import { useIsReadOnly } from '../contexts/EditorReadOnlyContext';
import {
  createIdentityLifecycle,
  IdentityLifecycleProvider,
} from '../contexts/IdentityLifecycleContext';
import { createTestQueryClient } from '../test-utils/render';

const PAGE_ID = '11111111-1111-4111-8111-111111111111';
const WIKI_TARGET_ID = '22222222-2222-4222-8222-222222222222';
const PARENT_FOLDER_ID = '33333333-3333-4333-8333-333333333333';
const EDIT_CAPABILITIES: CapabilitySet = {
  canEdit: true,
  canDelete: false,
  canCopy: true,
  canComment: true,
};
const VIEW_CAPABILITIES: CapabilitySet = {
  canEdit: false,
  canDelete: false,
  canCopy: true,
  canComment: false,
};

vi.mock('../components/AppShellToolbar', () => ({
  AppShellToolbar: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAppShellOutletContext: () => ({ contentContainer: mocks.contentContainer }),
}));
vi.mock('../components/AppShell', () => ({
  AppShell: ({ contentState }: { contentState: AppShellContentState }) =>
    contentState.status === 'loading' ? contentState.content : <Outlet />,
}));

const mocks = vi.hoisted(() => ({
  contentContainer: null as HTMLDivElement | null,
  share: {
    isAnonymous: false,
    capabilities: {
      canEdit: true,
      canDelete: false,
      canCopy: true,
      canComment: true,
    },
    accessPermission: 'edit' as 'view' | 'commenter' | 'edit' | 'admin' | null,
  },
  currentUserId: 'current-user',
  setAccessPermission: vi.fn(),
  setCapabilities: vi.fn(),
  loggerError: vi.fn(),
  snapshotPermission: 'edit' as 'view' | 'commenter' | 'edit' | 'admin' | null,
  statusChange: null as ((status: WebSocketStatus) => void) | null,
  permissionSnapshot: null as
    | ((permission: 'view' | 'commenter' | 'edit' | 'admin' | null, revision: string) => void)
    | null,
  commentSelection: null as ((anchor: { quote: string } | null) => void) | null,
  wikiLinkClick: null as ((target: { id: string; title: string; heading?: string }) => void) | null,
}));

vi.mock('../contexts/ShareContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../contexts/ShareContext')>()),
  useShareContext: () => mocks.share,
  useSetAccessPermission: () => mocks.setAccessPermission,
  useSetCapabilities: () => mocks.setCapabilities,
}));
vi.mock('../hooks/use-pages', () => ({
  usePageTree: () => ({ data: [], isSuccess: true }),
}));
vi.mock('../hooks/use-folders', () => ({
  useFolderTree: () => ({ data: [], isSuccess: true }),
}));
vi.mock('../hooks/use-stars', () => ({
  useStars: () => ({ data: [] }),
  useToggleStar: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/use-shared-with-me', () => ({
  useSharedWithMeTree: () => ({ data: [], isSuccess: true }),
}));
vi.mock('../hooks/use-workspace', () => ({
  useWorkspaceMemberships: () => ({ data: [], isSuccess: true }),
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ data: { user: { id: mocks.currentUserId } }, isPending: false }),
}));
vi.mock('../hooks/use-page-collaborators', () => ({
  usePageCollaborators: () => ({ data: undefined }),
}));
vi.mock('../logger-init', () => ({
  getLogger: () => ({ error: mocks.loggerError }),
}));
vi.mock('../components/editor/BacklinksPanel', () => ({
  BacklinksPanel: () => <div data-testid="backlinks" />,
}));
vi.mock('../components/editor/Breadcrumbs', () => ({ Breadcrumbs: () => null }));
vi.mock('../components/editor/ShareDialog', () => ({
  ShareDialog: ({ title }: { title: string }) => (
    <div role="dialog" aria-label={`Share ${title}`} />
  ),
}));
vi.mock('../components/editor/CommentsPanel', () => ({
  CommentsPanel: ({
    selectedAnchor,
    isDrawer,
  }: {
    selectedAnchor: { quote: string } | null;
    isDrawer: boolean;
  }) => (
    <div
      data-testid="comments-panel"
      data-selected-quote={selectedAnchor?.quote ?? ''}
      data-is-drawer={String(isDrawer)}
    />
  ),
}));
vi.mock('../components/editor/PageIcon', () => ({
  PageIcon: () => {
    const readOnly = useIsReadOnly();
    return <div data-testid="page-icon" data-read-only={String(readOnly)} />;
  },
}));
vi.mock('../components/editor/PageTitle', () => ({
  PageTitle: () => {
    const readOnly = useIsReadOnly();
    return <div data-testid="page-title" data-read-only={String(readOnly)} />;
  },
}));
vi.mock('../components/editor/PropertiesPanel', () => ({
  PropertiesPanel: () => {
    const readOnly = useIsReadOnly();
    return <div data-testid="properties" data-read-only={String(readOnly)} />;
  },
}));
vi.mock('../components/editor/CodeMirrorEditor', async () => {
  const { useEffect } = await import('react');
  return {
    CodeMirrorEditor: ({
      hideInlineCommentCards,
      onPermissionSnapshot,
      onStatusChange,
      onWikiLinkClick,
      onCommentSelection,
    }: {
      hideInlineCommentCards: boolean;
      onPermissionSnapshot: (
        permission: 'view' | 'commenter' | 'edit' | 'admin' | null,
        revision: string,
      ) => void;
      onStatusChange: (status: WebSocketStatus) => void;
      onWikiLinkClick: (target: { id: string; title: string; heading?: string }) => void;
      onCommentSelection: (anchor: { quote: string } | null) => void;
    }) => {
      const readOnly = useIsReadOnly();
      mocks.statusChange = onStatusChange;
      mocks.permissionSnapshot = onPermissionSnapshot;
      mocks.wikiLinkClick = onWikiLinkClick;
      mocks.commentSelection = onCommentSelection;
      useEffect(() => {
        onPermissionSnapshot(mocks.snapshotPermission, '1');
      }, [onPermissionSnapshot]);
      return (
        <div
          data-testid="page-body"
          data-read-only={String(readOnly)}
          data-hide-inline-comment-cards={String(hideInlineCommentCards)}
        />
      );
    },
  };
});
vi.mock('../components/editor/CollabStatus', () => ({ CollabStatus: () => null }));
vi.mock('../components/editor/TableOfContents', () => ({ TableOfContents: () => null }));
vi.mock('../components/ThemeToggle', () => ({ ThemeToggle: () => null }));

import { ShareablePageRoute } from '../components/auth/ShareablePageRoute';
import Page from './Page';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.hash}`}</output>;
}

function pageResponse(permission: 'view' | 'edit', ownerId = 'owner-1') {
  return {
    accessScope: 'account',
    id: PAGE_ID,
    parentId: null,
    title: 'Test Page',
    icon: null,
    coverType: null,
    coverValue: null,
    position: 'a0',
    properties: null,
    createdBy: ownerId,
    ownerId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publicPermission: null,
    inheritancePolicy: 'inherit',
    userPermission: permission,
    capabilities: permission === 'edit' ? EDIT_CAPABILITIES : VIEW_CAPABILITIES,
  };
}

function renderPage({
  withShareableRoute = false,
  initialEntries = [`/test-page-${PAGE_ID}`],
}: {
  withShareableRoute?: boolean;
  initialEntries?: string[];
} = {}) {
  const queryClient = createTestQueryClient();
  const lifecycle = createIdentityLifecycle();
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <LocationProbe />
            <Outlet />
          </>
        ),
        children: [
          { path: '/', element: <output>Workspace home</output> },
          { path: '/settings', element: <output>Settings</output> },
          { path: '/folder/:slugAndId', element: <output>Folder</output> },
          {
            path: '/:slugAndId',
            element: withShareableRoute ? (
              <ShareablePageRoute entityType="page" loadingState={<output>Loading page</output>} />
            ) : (
              <Outlet />
            ),
            children: [{ index: true, element: <Page /> }],
          },
        ],
      },
    ],
    { initialEntries },
  );
  const result = render(
    <QueryClientProvider client={queryClient}>
      <IdentityLifecycleProvider lifecycle={lifecycle}>
        <ClipboardProvider>
          <RouterProvider router={router} />
        </ClipboardProvider>
      </IdentityLifecycleProvider>
    </QueryClientProvider>,
  );
  return { queryClient, router, lifecycle, ...result };
}

function mockPageFetch(permission: 'view' | 'edit', accessResponses: Array<boolean> = [true]) {
  let accessIndex = 0;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/api/pages/${PAGE_ID}`) {
      return {
        ok: true,
        status: 200,
        json: async () => pageResponse(permission),
      } as Response;
    }
    if (url === `/api/pages/${PAGE_ID}/access`) {
      const ok = accessResponses[accessIndex] ?? accessResponses.at(-1) ?? false;
      accessIndex += 1;
      return {
        ok,
        status: ok ? 200 : 500,
        json: async () => ({ ok: true }),
      } as Response;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

function mockPageFetchSequence(statuses: number[]) {
  let pageIndex = 0;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/api/pages/${PAGE_ID}`) {
      const status = statuses[pageIndex] ?? statuses.at(-1) ?? 500;
      pageIndex += 1;
      return {
        ok: status === 200,
        status,
        json: async () =>
          status === 200 ? pageResponse('edit') : { message: `Request failed (${status})` },
      } as Response;
    }
    if (url === `/api/pages/${PAGE_ID}/access`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

describe('Page permission presentation', () => {
  beforeEach(() => {
    mocks.currentUserId = 'current-user';
    mocks.contentContainer = null;
    mocks.setAccessPermission.mockReset();
    mocks.setCapabilities.mockReset();
    mocks.share = {
      isAnonymous: false,
      capabilities: EDIT_CAPABILITIES,
      accessPermission: 'edit',
    };
    mocks.snapshotPermission = 'edit';
    mocks.statusChange = null;
    mocks.permissionSnapshot = null;
    mocks.wikiLinkClick = null;
    mocks.commentSelection = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(`metakip-page-full-width:${PAGE_ID}`);
  });

  it('does not apply a saved wide preference to anonymous visitors', async () => {
    localStorage.setItem(`metakip-page-full-width:${PAGE_ID}`, 'true');
    mocks.share = {
      isAnonymous: true,
      capabilities: VIEW_CAPABILITIES,
      accessPermission: 'view',
    };
    mocks.snapshotPermission = 'view';
    vi.stubGlobal('fetch', mockPageFetch('view'));
    await renderPage();

    await screen.findByTestId('page-body');

    expect(document.querySelector('.page-layout')).not.toHaveClass('page-layout--wide');
    expect(screen.queryByRole('button', { name: 'Full width' })).not.toBeInTheDocument();
  });

  it('toggles and persists page width through the toolbar action menu', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', mockPageFetch('edit'));
    await renderPage();
    await screen.findByTestId('page-body');

    const menu = screen.getByRole('button', { name: 'Page actions' });
    expect(screen.queryByRole('button', { name: 'Full width' })).not.toBeInTheDocument();
    await user.click(menu);
    await user.click(await screen.findByRole('menuitem', { name: 'Full width' }));
    expect(document.querySelector('.page-layout')).toHaveClass('page-layout--wide');
    expect(localStorage.getItem(`metakip-page-full-width:${PAGE_ID}`)).toBe('true');

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await user.click(menu);
    await user.click(await screen.findByRole('menuitem', { name: 'Default width' }));
    expect(document.querySelector('.page-layout')).not.toHaveClass('page-layout--wide');
    expect(localStorage.getItem(`metakip-page-full-width:${PAGE_ID}`)).toBe('false');
  });

  it('keeps editor surfaces editable but hides account-only controls for anonymous public editors', async () => {
    mocks.share = {
      isAnonymous: true,
      capabilities: EDIT_CAPABILITIES,
      accessPermission: 'edit',
    };
    vi.stubGlobal('fetch', mockPageFetch('edit'));
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-body')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('page-title')).toHaveAttribute('data-read-only', 'false');
    });
    expect(screen.getByTestId('page-icon')).toHaveAttribute('data-read-only', 'false');
    expect(screen.getByTestId('properties')).toHaveAttribute('data-read-only', 'false');
    expect(screen.queryByRole('button', { name: 'Share page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Page actions' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('backlinks')).not.toBeInTheDocument();
  });

  it('keeps the entire page read-only for anonymous viewers', async () => {
    mocks.share = {
      isAnonymous: true,
      capabilities: VIEW_CAPABILITIES,
      accessPermission: 'view',
    };
    mocks.snapshotPermission = 'view';
    vi.stubGlobal('fetch', mockPageFetch('view'));
    await renderPage();

    expect(await screen.findByTestId('page-body')).toHaveAttribute('data-read-only', 'true');
    expect(screen.getByTestId('page-title')).toHaveAttribute('data-read-only', 'true');
    expect(screen.getByTestId('page-icon')).toHaveAttribute('data-read-only', 'true');
    expect(screen.getByTestId('properties')).toHaveAttribute('data-read-only', 'true');
  });

  it('keeps all editor metadata controls editable for a signed-in editor', async () => {
    vi.stubGlobal('fetch', mockPageFetch('edit'));
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-body')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('page-title')).toHaveAttribute('data-read-only', 'false');
    });
    expect(screen.getByTestId('page-icon')).toHaveAttribute('data-read-only', 'false');
    expect(screen.getByTestId('properties')).toHaveAttribute('data-read-only', 'false');
    expect(screen.getByRole('button', { name: 'Share page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page actions' })).toBeInTheDocument();
  });

  it('navigates only with the target already resolved by the server presentation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/pages/${PAGE_ID}`) {
        return { ok: true, status: 200, json: async () => pageResponse('edit') } as Response;
      }
      if (url === `/api/pages/${PAGE_ID}/access` || url === `/api/pages/${WIKI_TARGET_ID}/access`) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      if (url === `/api/pages/${WIKI_TARGET_ID}`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ...pageResponse('edit'),
            id: WIKI_TARGET_ID,
            title: 'Renamed target',
          }),
        } as Response;
      }
      if (url.startsWith('/api/v1/pages/') && url.includes('/comments?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [], nextCursor: null }),
        } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();
    await screen.findByTestId('page-body');

    act(() => mocks.commentSelection?.({ quote: 'Text from the previous page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open comments' }));
    expect(screen.getByTestId('comments-panel')).toHaveAttribute(
      'data-selected-quote',
      'Text from the previous page',
    );

    await act(async () => {
      mocks.wikiLinkClick?.({
        id: WIKI_TARGET_ID,
        title: 'Renamed target',
        heading: 'Release Milestones',
      });
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/pages/${WIKI_TARGET_ID}`);
    });
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/renamed-target-${WIKI_TARGET_ID}#release-milestones`,
    );
    await waitFor(() => expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument());
  });

  it('closes comments when live permission removes comment access', async () => {
    vi.stubGlobal('fetch', mockPageFetch('edit'));
    await renderPage();
    await screen.findByTestId('page-body');

    await userEvent.click(screen.getByRole('button', { name: 'Open comments' }));
    expect(screen.getByTestId('comments-panel')).toBeInTheDocument();
    expect(screen.getByTestId('page-body')).toHaveAttribute(
      'data-hide-inline-comment-cards',
      'true',
    );

    act(() => mocks.permissionSnapshot?.('view', '2'));

    await waitFor(() => {
      expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('page-body')).toHaveAttribute(
        'data-hide-inline-comment-cards',
        'true',
      );
    });
  });

  it('keeps comments open when the available content width changes', async () => {
    let width = 1100;
    const contentContainer = document.createElement('div');
    Object.defineProperty(contentContainer, 'clientWidth', { get: () => width });
    mocks.contentContainer = contentContainer;
    let notifyResize: (() => void) | undefined;
    class TrackingResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', TrackingResizeObserver);
    vi.stubGlobal('fetch', mockPageFetch('edit'));
    await renderPage();
    await screen.findByTestId('page-body');

    await userEvent.click(screen.getByRole('button', { name: 'Open comments' }));
    expect(screen.getByTestId('comments-panel')).toHaveAttribute('data-is-drawer', 'false');

    width = 900;
    act(() => notifyResize?.());
    expect(screen.getByTestId('comments-panel')).toHaveAttribute('data-is-drawer', 'true');

    width = 1100;
    act(() => notifyResize?.());
    expect(screen.getByTestId('comments-panel')).toHaveAttribute('data-is-drawer', 'false');
  });

  it('fails closed without labeling unresolved permission as confirmed View Access', async () => {
    vi.stubGlobal('fetch', mockPageFetch('edit'));
    await renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('page-body')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('page-title')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('page-icon')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('properties')).toHaveAttribute('data-read-only', 'false');
    });

    act(() => mocks.statusChange?.(WebSocketStatus.Disconnected));
    await waitFor(() => {
      expect(screen.getByTestId('page-body')).toHaveAttribute('data-read-only', 'true');
      expect(screen.getByTestId('page-title')).toHaveAttribute('data-read-only', 'true');
      expect(screen.getByTestId('page-icon')).toHaveAttribute('data-read-only', 'true');
      expect(screen.getByTestId('properties')).toHaveAttribute('data-read-only', 'true');
    });
    expect(screen.queryByText('View Access')).not.toBeInTheDocument();

    act(() => mocks.statusChange?.(WebSocketStatus.Connected));
    expect(screen.getByTestId('page-body')).toHaveAttribute('data-read-only', 'true');
    expect(screen.getByTestId('page-icon')).toHaveAttribute('data-read-only', 'true');
    expect(screen.queryByText('View Access')).not.toBeInTheDocument();

    act(() => mocks.permissionSnapshot?.('view', '2'));
    expect(screen.getByText('View Access')).toBeInTheDocument();

    act(() => mocks.permissionSnapshot?.('edit', '3'));
    await waitFor(() => {
      expect(screen.getByTestId('page-body')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('page-title')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('page-icon')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('properties')).toHaveAttribute('data-read-only', 'false');
    });
  });

  it('does not reopen sharing after navigation unmounts the page controls', async () => {
    let resolveNextPage: (response: Response) => void;
    const nextPage = new Promise<Response>((resolve) => {
      resolveNextPage = resolve;
    });
    const pageFetch = mockPageFetch('edit');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (String(input) === `/api/pages/${WIKI_TARGET_ID}`) return nextPage;
        if (String(input) === `/api/pages/${WIKI_TARGET_ID}/access`) {
          return Promise.resolve(new Response('{}'));
        }
        return pageFetch(input);
      }),
    );
    await renderPage();
    await screen.findByTestId('page-body');
    await userEvent.click(screen.getByRole('button', { name: 'Share page' }));
    expect(screen.getByRole('dialog', { name: 'Share Test Page' })).toBeInTheDocument();

    await act(async () => {
      mocks.wikiLinkClick?.({ id: WIKI_TARGET_ID, title: 'Next page' });
    });
    await waitFor(() => expect(screen.queryByTestId('page-body')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      resolveNextPage(
        new Response(
          JSON.stringify({ ...pageResponse('edit'), id: WIKI_TARGET_ID, title: 'Next page' }),
        ),
      );
    });
    await screen.findByTestId('page-body');
    expect(screen.getByRole('button', { name: 'Share page' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    {
      scenario: 'another page with a new route instance',
      withShareableRoute: true,
      leave: 'page',
      returnToPage: false,
    },
    {
      scenario: 'another page in the existing route instance',
      withShareableRoute: false,
      leave: 'page',
      returnToPage: false,
    },
    {
      scenario: 'a non-page route',
      withShareableRoute: true,
      leave: 'settings',
      returnToPage: false,
    },
    { scenario: 'browser Back', withShareableRoute: true, leave: 'back', returnToPage: false },
    {
      scenario: 'leaving and reopening the same page',
      withShareableRoute: true,
      leave: 'page',
      returnToPage: true,
    },
    {
      scenario: 'leaving and reopening the same page without remounting',
      withShareableRoute: false,
      leave: 'page',
      returnToPage: true,
    },
  ] as const)('does not redirect after $scenario', async ({
    withShareableRoute,
    leave,
    returnToPage,
  }) => {
    mocks.currentUserId = 'owner-1';
    let resolveDeletion: (response: Response) => void;
    const deletion = new Promise<Response>((resolve) => {
      resolveDeletion = resolve;
    });
    const pageFetch = mockPageFetch('edit');
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === `/api/pages/${PAGE_ID}` && init?.method === 'DELETE') return deletion;
      if (url === `/api/pages/${WIKI_TARGET_ID}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ...pageResponse('edit'), id: WIKI_TARGET_ID, title: 'Next Page' }),
          ),
        );
      }
      if (url === `/api/pages/${WIKI_TARGET_ID}/access`) {
        return Promise.resolve(new Response('{}'));
      }
      return pageFetch(input);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { queryClient, router } = renderPage({
      withShareableRoute,
      initialEntries: ['/settings', `/test-page-${PAGE_ID}`],
    });
    await screen.findByTestId('page-body');
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/pages/${PAGE_ID}`,
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );

    await act(async () => {
      if (leave === 'back') {
        await router.navigate(-1);
      } else {
        await router.navigate(leave === 'page' ? `/next-page-${WIKI_TARGET_ID}` : '/settings');
      }
    });
    if (leave === 'page') {
      await screen.findByTestId('page-body');
    } else {
      expect(screen.queryByTestId('page-body')).not.toBeInTheDocument();
    }
    if (returnToPage) {
      await act(async () => {
        await router.navigate(-1);
      });
      await screen.findByTestId('page-body');
    }
    const destination = returnToPage
      ? `/test-page-${PAGE_ID}`
      : leave === 'page'
        ? `/next-page-${WIKI_TARGET_ID}`
        : '/settings';
    expect(screen.getByTestId('location')).toHaveTextContent(destination);

    await act(async () => {
      resolveDeletion(new Response(JSON.stringify({ deleted: true })));
      await deletion;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(screen.getByTestId('location').textContent).toBe(destination);
  });

  it.each([
    null,
    PARENT_FOLDER_ID,
  ])('replaces the removed page in history with its exit destination (parent: %s)', async (parentId) => {
    mocks.currentUserId = 'owner-1';
    const pageFetch = mockPageFetch('edit');
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === `/api/pages/${PAGE_ID}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              init?.method === 'DELETE' ? { deleted: true } : { ...pageResponse('edit'), parentId },
            ),
          ),
        );
      }
      return pageFetch(input);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { router } = renderPage({
      withShareableRoute: true,
      initialEntries: ['/settings', `/test-page-${PAGE_ID}`],
    });
    await screen.findByTestId('page-body');
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        parentId ? `/folder/folder-${parentId}` : '/',
      ),
    );

    await act(async () => {
      await router.navigate(-1);
    });
    expect(screen.getByTestId('location').textContent).toBe('/settings');
  });

  it('does not redirect when the identity retires before removal finishes', async () => {
    mocks.currentUserId = 'owner-1';
    let resolveDeletion: (response: Response) => void;
    const deletion = new Promise<Response>((resolve) => {
      resolveDeletion = resolve;
    });
    const pageFetch = mockPageFetch('edit');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === `/api/pages/${PAGE_ID}` && init?.method === 'DELETE'
          ? deletion
          : pageFetch(input),
      ),
    );
    const { queryClient, lifecycle } = renderPage({ withShareableRoute: true });
    await screen.findByTestId('page-body');
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));
    await waitFor(() => expect(queryClient.isMutating()).toBe(1));
    lifecycle.retire();

    await act(async () => {
      resolveDeletion(new Response(JSON.stringify({ deleted: true })));
      await deletion;
    });
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(screen.getByTestId('location').textContent).toBe(`/test-page-${PAGE_ID}`);
  });

  it('uses the new location after moving a page without collaboration updates', async () => {
    mocks.currentUserId = 'owner-1';
    let storedParentId: string | null = PARENT_FOLDER_ID;
    const pageFetch = mockPageFetch('edit');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === `/api/pages/${PAGE_ID}/move`) {
          storedParentId = null;
          return Promise.resolve(new Response('{}'));
        }
        if (String(input) === `/api/pages/${PAGE_ID}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify(
                init?.method === 'DELETE'
                  ? { deleted: true }
                  : { ...pageResponse('edit'), parentId: storedParentId },
              ),
            ),
          );
        }
        return pageFetch(input);
      }),
    );
    const { queryClient } = renderPage({ withShareableRoute: true });
    await screen.findByTestId('page-body');
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Move item' })).not.toBeInTheDocument(),
    );
    expect(queryClient.getQueryData(['pages', 'detail', PAGE_ID])).toMatchObject({
      parentId: null,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });

  it('does not redirect when removal fails', async () => {
    mocks.currentUserId = 'owner-1';
    const pageFetch = mockPageFetch('edit');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === `/api/pages/${PAGE_ID}` && init?.method === 'DELETE'
          ? Promise.resolve(
              new Response(JSON.stringify({ message: 'Removal failed' }), { status: 500 }),
            )
          : pageFetch(input),
      ),
    );
    const { queryClient } = renderPage({ withShareableRoute: true });
    await screen.findByTestId('page-body');
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(screen.getByTestId('location').textContent).toBe(`/test-page-${PAGE_ID}`);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});

describe('Page request errors', () => {
  beforeEach(() => {
    mocks.currentUserId = 'current-user';
    mocks.share = {
      isAnonymous: false,
      capabilities: EDIT_CAPABILITIES,
      accessPermission: 'edit',
    };
    mocks.snapshotPermission = 'edit';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('presents a terminal not-found state for a 404', async () => {
    vi.stubGlobal('fetch', mockPageFetchSequence([404]));
    await renderPage();

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('lets a transient server error be retried', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', mockPageFetchSequence([500, 200]));
    await renderPage();

    expect(
      await screen.findByRole('heading', { name: "Couldn't load this page" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('page-body')).toBeInTheDocument();
  });
});

describe('Page access recording retries', () => {
  beforeEach(() => {
    mocks.currentUserId = 'current-user';
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.loggerError.mockReset();
    mocks.share = {
      isAnonymous: false,
      capabilities: EDIT_CAPABILITIES,
      accessPermission: 'edit',
    };
    mocks.snapshotPermission = 'edit';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries once and succeeds without logging an error', async () => {
    const fetchMock = mockPageFetch('edit', [false, true]);
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();
    expect(await screen.findByTestId('page-body')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const accessCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === `/api/pages/${PAGE_ID}/access`,
    );
    expect(accessCalls).toHaveLength(2);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('logs after the retry also fails', async () => {
    const fetchMock = mockPageFetch('edit', [false, false]);
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();
    expect(await screen.findByTestId('page-body')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await waitFor(() => {
      expect(mocks.loggerError).toHaveBeenCalledWith(
        'Failed to record page access after retry',
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });

  it('cancels a scheduled retry when the page unmounts', async () => {
    const fetchMock = mockPageFetch('edit', [false, true]);
    vi.stubGlobal('fetch', fetchMock);
    const rendered = await renderPage();
    expect(await screen.findByTestId('page-body')).toBeInTheDocument();

    rendered.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const accessCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === `/api/pages/${PAGE_ID}/access`,
    );
    expect(accessCalls).toHaveLength(1);
  });
});
