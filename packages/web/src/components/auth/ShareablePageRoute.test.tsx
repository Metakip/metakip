import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useShareContext } from '../../contexts/ShareContext';
import { createTestQueryClient } from '../../test-utils/render';

const FOLDER_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';
const observedCanEdit: boolean[] = [];

const { authState, refetchAuth } = vi.hoisted(() => ({
  authState: {
    session: { user: { id: 'viewer-1' } } as { user: { id: string } } | null,
    error: null as { status: number } | null,
  },
  refetchAuth: vi.fn(),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    data: authState.session,
    error: authState.error,
    isPending: false,
    refetch: refetchAuth,
  }),
}));

vi.mock('../AppShell', () => ({
  AppShell: ({
    contentState = { status: 'ready' },
  }: {
    contentState?: { status: 'ready' } | { status: 'loading'; content: ReactElement } | undefined;
  }) => (
    <section data-testid="app-shell">
      {contentState.status === 'loading' ? contentState.content : <AccessProbe />}
    </section>
  ),
}));

import { ShareablePageRoute } from './ShareablePageRoute';

function AccessProbe() {
  const { capabilities } = useShareContext();
  observedCanEdit.push(capabilities.canEdit);
  return <output data-testid="can-edit">{String(capabilities.canEdit)}</output>;
}

function folderEntity(permission: 'view' | 'edit') {
  return {
    accessScope: 'account' as const,
    id: FOLDER_ID,
    parentId: null,
    name: 'Folder',
    icon: null,
    position: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publicPermission: null,
    createdBy: 'owner-1',
    ownerId: 'owner-1',
    userPermission: permission,
    inheritancePolicy: 'inherit',
    capabilities: {
      canEdit: permission === 'edit',
      canDelete: false,
      canCopy: true,
      canComment: permission === 'edit',
    },
    pages: [],
    folders: [],
  };
}

afterEach(() => {
  onlineManager.setOnline(true);
  authState.session = { user: { id: 'viewer-1' } };
  authState.error = null;
  refetchAuth.mockReset();
  observedCanEdit.length = 0;
  vi.unstubAllGlobals();
});

function LoginProbe() {
  const location = useLocation();
  const state = location.state as { from?: { pathname?: string } } | null;
  return <output data-testid="login-return-path">{state?.from?.pathname ?? ''}</output>;
}

describe('ShareablePageRoute', () => {
  it('keeps the application shell mounted when entity loading completes', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const entityResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => entityResponse),
    );
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/folder/folder-${FOLDER_ID}`]}>
          <Routes>
            <Route
              path="/folder/:slugAndId"
              element={
                <ShareablePageRoute
                  entityType="folder"
                  loadingState={<output>Loading folder</output>}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const shell = await screen.findByTestId('app-shell');
    expect(screen.getByText('Loading folder')).toBeInTheDocument();
    expect(screen.queryByTestId('can-edit')).not.toBeInTheDocument();

    await act(async () => {
      resolveFetch?.(
        new Response(JSON.stringify(folderEntity('edit')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await entityResponse;
    });

    await waitFor(() => expect(screen.getByTestId('can-edit')).toHaveTextContent('true'));
    expect(screen.getByTestId('app-shell')).toBe(shell);
  });

  it('invalidates every access-sensitive cache when a polled permission changes', async () => {
    const queryClient = createTestQueryClient();
    const entityKey = ['folders', 'detail', FOLDER_ID] as const;
    queryClient.setQueryDefaults(entityKey, { staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(entityKey, folderEntity('edit'));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/folder/folder-${FOLDER_ID}`]}>
          <Routes>
            <Route
              path="/folder/:slugAndId"
              element={
                <ShareablePageRoute
                  entityType="folder"
                  loadingState={<output>Loading folder</output>}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const shellProbe = await screen.findByTestId('can-edit');
    expect(shellProbe).toHaveTextContent('true');
    invalidateSpy.mockClear();
    observedCanEdit.length = 0;

    act(() => queryClient.setQueryData(entityKey, folderEntity('view')));

    await waitFor(() => expect(screen.getByTestId('can-edit')).toHaveTextContent('false'));
    expect(observedCanEdit).not.toContain(true);
    expect(screen.getByTestId('can-edit')).toBe(shellProbe);

    observedCanEdit.length = 0;
    act(() => queryClient.setQueryData(entityKey, folderEntity('edit')));
    await waitFor(() => expect(screen.getByTestId('can-edit')).toHaveTextContent('true'));
    expect(observedCanEdit).not.toContain(false);

    for (const queryKey of [
      ['pageTree'],
      ['folderTree'],
      ['pages', 'recent'],
      ['shares'],
      ['pageCollaborators'],
      ['folderCollaborators'],
      ['pages', 'detail'],
      ['folders', 'detail'],
    ]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('keeps the application shell mounted across a retryable polling failure', async () => {
    const queryClient = createTestQueryClient();
    const entityKey = ['folders', 'detail', FOLDER_ID] as const;
    queryClient.setQueryDefaults(entityKey, { staleTime: Number.POSITIVE_INFINITY });
    queryClient.setQueryData(entityKey, folderEntity('edit'));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/folder/folder-${FOLDER_ID}`]}>
          <Routes>
            <Route
              path="/folder/:slugAndId"
              element={
                <ShareablePageRoute
                  entityType="folder"
                  loadingState={<output>Loading folder</output>}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const shell = await screen.findByTestId('app-shell');
    expect(screen.getByTestId('can-edit')).toHaveTextContent('true');

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: entityKey, exact: true });
    });

    expect(
      await screen.findByText('The server returned an error. Try again in a moment.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('app-shell')).toBe(shell);
    expect(screen.queryByTestId('can-edit')).not.toBeInTheDocument();
  });

  it('shows a retry state when the initial entity request is paused', async () => {
    onlineManager.setOnline(false);
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/page-${PAGE_ID}`]}>
          <Routes>
            <Route
              path="/:slugAndId"
              element={
                <ShareablePageRoute
                  entityType="page"
                  loadingState={<output>Loading page</output>}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
  });

  it('retries the entity request after session revalidation restores authentication', async () => {
    refetchAuth.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(folderEntity('edit')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/folder/folder-${FOLDER_ID}`]}>
          <Routes>
            <Route
              path="/folder/:slugAndId"
              element={
                <ShareablePageRoute
                  entityType="folder"
                  loadingState={<output>Loading folder</output>}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(refetchAuth).toHaveBeenCalledWith({ query: { disableCookieCache: true } }),
    );
    expect(await screen.findByTestId('can-edit')).toHaveTextContent('true');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows an access error when the retried entity request remains unauthorized', async () => {
    refetchAuth.mockResolvedValue(undefined);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/page-${PAGE_ID}`]}>
          <Routes>
            <Route
              path="/:slugAndId"
              element={
                <ShareablePageRoute
                  entityType="page"
                  loadingState={<output>Loading page</output>}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(refetchAuth).toHaveBeenCalledWith({ query: { disableCookieCache: true } }),
    );
    expect(await screen.findByText("You don't have access")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves the original URL when authoritative revalidation confirms logout', async () => {
    refetchAuth.mockImplementation(async () => {
      authState.session = null;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/page-${PAGE_ID}`]}>
          <Routes>
            <Route
              path="/:slugAndId"
              element={
                <ShareablePageRoute
                  entityType="page"
                  loadingState={<output>Loading page</output>}
                />
              }
            />
            <Route path="/login" element={<LoginProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('login-return-path')).toHaveTextContent(`/page-${PAGE_ID}`);
  });

  it('keeps the entity route retryable when session revalidation fails temporarily', async () => {
    refetchAuth.mockImplementation(async () => {
      authState.error = { status: 503 };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/page-${PAGE_ID}`]}>
          <Routes>
            <Route
              path="/:slugAndId"
              element={
                <ShareablePageRoute
                  entityType="page"
                  loadingState={<output>Loading page</output>}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
  });
});
