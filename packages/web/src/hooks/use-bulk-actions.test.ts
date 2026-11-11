import { focusManager, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createIdentityLifecycle,
  IdentityLifecycleProvider,
} from '../contexts/IdentityLifecycleContext';
import { createTestQueryClient, createWrapper } from '../test-utils/wrapper';
import { isBulkRemovalInProgress } from '../utils/bulkRemovalState';

const toastMocks = vi.hoisted(() => ({
  showSuccessToast: vi.fn(),
}));

vi.mock('../utils/toast', () => ({
  showSuccessToast: toastMocks.showSuccessToast,
  showErrorToast: vi.fn(),
  showInfoToast: vi.fn(),
}));

import {
  buildBulkRemovalInput,
  getBulkRemovalCounts,
  useBulkMoveFolders,
  useBulkMovePages,
  useBulkRemoveEntities,
} from './use-bulk-actions';
import { useFavorites } from './use-favorites';
import { usePageCollaborators } from './use-page-collaborators';

describe('bulk removal planning', () => {
  it('trashes only owned items and personally removes every eligible non-owned item', () => {
    const input = buildBulkRemovalInput(
      [
        { id: 'owned-page', type: 'page', ownerId: 'user-1' },
        {
          id: 'admin-page',
          type: 'page',
          ownerId: 'owner-1',
          userPermission: 'admin',
          shareSource: 'direct',
        },
        {
          id: 'public-folder',
          type: 'folder',
          ownerId: 'owner-1',
          shareSource: 'public',
        },
        {
          id: 'workspace-page',
          type: 'page',
          ownerId: 'owner-1',
          shareSource: 'workspace',
        },
      ],
      'user-1',
    );

    expect(input).toEqual({
      operations: [
        { entityType: 'page', entityId: 'owned-page', action: 'trash' },
        { entityType: 'page', entityId: 'admin-page', action: 'remove-from-view' },
        { entityType: 'folder', entityId: 'public-folder', action: 'remove-from-view' },
      ],
    });
    expect(getBulkRemovalCounts(input)).toEqual({ trashCount: 1, removeFromViewCount: 2 });
  });
});

function createIdentityWrapper(
  queryClient: ReturnType<typeof createTestQueryClient>,
  lifecycle: ReturnType<typeof createIdentityLifecycle>,
) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(IdentityLifecycleProvider, { lifecycle }, children),
    );
}

describe('useBulkRemoveEntities', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    toastMocks.showSuccessToast.mockReset();
  });

  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it('removes mixed owned and shared items with one refresh and toast', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          removedItems: [
            { entityType: 'page', entityId: 'owned-page', action: 'trash' },
            { entityType: 'folder', entityId: 'owned-folder', action: 'trash' },
            { entityType: 'page', entityId: 'shared-page', action: 'remove-from-view' },
            { entityType: 'folder', entityId: 'shared-folder', action: 'remove-from-view' },
          ],
          failedItems: [],
          trashedCount: 2,
          removedFromViewCount: 2,
        }),
    });

    const { result } = renderHook(() => useBulkRemoveEntities(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      operations: [
        { entityType: 'page', entityId: 'owned-page', action: 'trash' },
        { entityType: 'folder', entityId: 'owned-folder', action: 'trash' },
        { entityType: 'page', entityId: 'shared-page', action: 'remove-from-view' },
        { entityType: 'folder', entityId: 'shared-folder', action: 'remove-from-view' },
      ],
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/bulk-removal',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          operations: [
            { entityType: 'page', entityId: 'owned-page', action: 'trash' },
            { entityType: 'folder', entityId: 'owned-folder', action: 'trash' },
            { entityType: 'page', entityId: 'shared-page', action: 'remove-from-view' },
            { entityType: 'folder', entityId: 'shared-folder', action: 'remove-from-view' },
          ],
        }),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledTimes(14);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pageTree'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['folderTree'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace-memberships'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace-members'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shares'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pages', 'detail'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tags'] });
    expect(toastMocks.showSuccessToast).toHaveBeenCalledOnce();
    expect(toastMocks.showSuccessToast).toHaveBeenCalledWith(
      'Moved 2 items to Trash; removed 2 items from your view',
    );
  });

  it('transports large selections in bounded batches with one aggregate completion', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        operations: Array<{ entityType: 'page'; entityId: string; action: 'trash' }>;
      };
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            removedItems: request.operations,
            failedItems: [],
            trashedCount: request.operations.length,
            removedFromViewCount: 0,
          }),
      });
    });
    const operations = Array.from({ length: 205 }, (_, index) => ({
      entityType: 'page' as const,
      entityId: `page-${index}`,
      action: 'trash' as const,
    }));
    const { result } = renderHook(() => useBulkRemoveEntities(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ operations });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map(([, init]) => {
        const request = JSON.parse(String((init as RequestInit | undefined)?.body)) as {
          operations: unknown[];
        };
        return request.operations.length;
      }),
    ).toEqual([100, 100, 5]);
    expect(result.current.data?.removedItems).toEqual(operations);
    expect(result.current.data?.trashedCount).toBe(205);
    expect(invalidateSpy).toHaveBeenCalledTimes(14);
    expect(toastMocks.showSuccessToast).toHaveBeenCalledOnce();
    expect(toastMocks.showSuccessToast).toHaveBeenCalledWith('Moved 205 items to Trash');
  });

  it('preserves confirmed successes when a later transport batch fails', async () => {
    const operations = Array.from({ length: 101 }, (_, index) => ({
      entityType: 'page' as const,
      entityId: `page-${index}`,
      action: 'trash' as const,
    }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          removedItems: operations.slice(0, 100),
          failedItems: [],
          trashedCount: 100,
          removedFromViewCount: 0,
        }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ message: 'Removal service is temporarily unavailable' }),
    });
    const { result } = renderHook(() => useBulkRemoveEntities(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ operations });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const remainingOperation = operations[100];
    if (!remainingOperation) throw new Error('Expected a remaining operation');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data?.removedItems).toEqual(operations.slice(0, 100));
    expect(result.current.data?.failedItems).toEqual([
      {
        ...remainingOperation,
        code: 'INTERNAL_ERROR',
        message: 'Removal service is temporarily unavailable',
      },
    ]);
    expect(result.current.data?.trashedCount).toBe(100);
    expect(toastMocks.showSuccessToast).not.toHaveBeenCalled();
  });

  it('cancels in-flight refreshes before issuing removal requests', async () => {
    let finishCancellation: (() => void) | undefined;
    const cancellation = new Promise<void>((resolve) => {
      finishCancellation = resolve;
    });
    const cancelSpy = vi.spyOn(queryClient, 'cancelQueries').mockReturnValue(cancellation);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          removedItems: [{ entityType: 'page', entityId: 'owned-page', action: 'trash' }],
          failedItems: [],
          trashedCount: 1,
          removedFromViewCount: 0,
        }),
    });

    const { result } = renderHook(() => useBulkRemoveEntities(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      operations: [{ entityType: 'page', entityId: 'owned-page', action: 'trash' }],
    });

    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledTimes(14);
    });
    expect(isBulkRemovalInProgress()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();

    finishCancellation?.();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(isBulkRemovalInProgress()).toBe(false);
  });

  it('suppresses new focus refreshes while removal requests are pending', async () => {
    let finishRemoval: (() => void) | undefined;
    const removal = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      finishRemoval = () =>
        resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              removedItems: [{ entityType: 'page', entityId: 'owned-page', action: 'trash' }],
              failedItems: [],
              trashedCount: 1,
              removedFromViewCount: 0,
            }),
        });
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/bulk-removal' && init?.method === 'POST') return removal;
      if (url.endsWith('/favorites')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ favorites: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const { result } = renderHook(
      () => {
        const bulkRemoval = useBulkRemoveEntities();
        useFavorites();
        usePageCollaborators(['page-1']);
        return bulkRemoval;
      },
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await queryClient.invalidateQueries({ queryKey: ['favorites'], refetchType: 'none' });
    await queryClient.invalidateQueries({ queryKey: ['pageCollaborators'], refetchType: 'none' });

    result.current.mutate({
      operations: [{ entityType: 'page', entityId: 'owned-page', action: 'trash' }],
    });
    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    finishRemoval?.();
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('holds metadata refreshes until the final bulk refresh completes', async () => {
    let resolveResponse:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const { result } = renderHook(() => useBulkRemoveEntities(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      operations: [{ entityType: 'page', entityId: 'owned-page', action: 'trash' }],
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });
    expect(isBulkRemovalInProgress()).toBe(true);

    resolveResponse?.({
      ok: true,
      json: () =>
        Promise.resolve({
          removedItems: [{ entityType: 'page', entityId: 'owned-page', action: 'trash' }],
          failedItems: [],
          trashedCount: 1,
          removedFromViewCount: 0,
        }),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(isBulkRemovalInProgress()).toBe(false);
  });

  it('attempts every removal and reports a partial failure', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          removedItems: [
            { entityType: 'page', entityId: 'owned-page', action: 'trash' },
            { entityType: 'page', entityId: 'shared-page', action: 'remove-from-view' },
          ],
          failedItems: [
            {
              entityType: 'page',
              entityId: 'failed-page',
              action: 'trash',
              code: 'FORBIDDEN',
              message: 'Forbidden',
            },
          ],
          trashedCount: 1,
          removedFromViewCount: 1,
        }),
    });

    const { result } = renderHook(() => useBulkRemoveEntities(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      operations: [
        { entityType: 'page', entityId: 'failed-page', action: 'trash' },
        { entityType: 'page', entityId: 'owned-page', action: 'trash' },
        { entityType: 'page', entityId: 'shared-page', action: 'remove-from-view' },
      ],
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual({
      removedItems: [
        { entityType: 'page', entityId: 'owned-page', action: 'trash' },
        { entityType: 'page', entityId: 'shared-page', action: 'remove-from-view' },
      ],
      failedItems: [
        {
          entityType: 'page',
          entityId: 'failed-page',
          action: 'trash',
          code: 'FORBIDDEN',
          message: 'Forbidden',
        },
      ],
      trashedCount: 1,
      removedFromViewCount: 1,
    });
    expect(toastMocks.showSuccessToast).not.toHaveBeenCalled();
  });

  it('does not start another transport batch after its identity retires', async () => {
    const operations = Array.from({ length: 101 }, (_, index) => ({
      entityType: 'page' as const,
      entityId: `page-${index}`,
      action: 'trash' as const,
    }));
    let finishFirstBatch: (() => void) | undefined;
    const firstBatch = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      finishFirstBatch = () =>
        resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              removedItems: operations.slice(0, 100),
              failedItems: [],
              trashedCount: 100,
              removedFromViewCount: 0,
            }),
        });
    });
    fetchMock.mockReturnValue(firstBatch);
    const lifecycle = createIdentityLifecycle();
    const wrapper = createIdentityWrapper(queryClient, lifecycle);
    const { result } = renderHook(() => useBulkRemoveEntities(), { wrapper });

    act(() => {
      result.current.mutate({ operations });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    lifecycle.retire();
    finishFirstBatch?.();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(toastMocks.showSuccessToast).not.toHaveBeenCalled();
  });

  it('does not show completion feedback after retiring during final refresh', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          removedItems: [{ entityType: 'page', entityId: 'owned-page', action: 'trash' }],
          failedItems: [],
          trashedCount: 1,
          removedFromViewCount: 0,
        }),
    });
    let finishRefresh: (() => void) | undefined;
    const refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(refresh);
    const lifecycle = createIdentityLifecycle();
    const { result } = renderHook(() => useBulkRemoveEntities(), {
      wrapper: createIdentityWrapper(queryClient, lifecycle),
    });

    act(() => {
      result.current.mutate({
        operations: [{ entityType: 'page', entityId: 'owned-page', action: 'trash' }],
      });
    });
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(14));

    lifecycle.retire();
    finishRefresh?.();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toastMocks.showSuccessToast).not.toHaveBeenCalled();
  });
});

describe('useBulkMovePages', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it('moves multiple pages to new parent', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useBulkMovePages(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ pageIds: ['p1', 'p2'], parentId: 'f1' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pages/p1/move',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ parentId: 'f1' }),
      }),
    );
  });

  it('refreshes moved page and folder details before completing without refreshing unrelated pages', async () => {
    let finishRefresh: ((detail: { parentId: string }) => void) | undefined;
    const refresh = new Promise<{ parentId: string }>((resolve) => {
      finishRefresh = resolve;
    });
    const detailQuery = vi
      .fn<() => Promise<{ parentId: string }>>()
      .mockResolvedValueOnce({ parentId: 'source' })
      .mockReturnValueOnce(refresh);
    const detailObserver = new QueryObserver(queryClient, {
      queryKey: ['pages', 'detail', 'p1'],
      queryFn: detailQuery,
    });
    queryClient.setQueryData(['pages', 'detail', 'unrelated'], { parentId: 'other' });
    queryClient.setQueryData(['folders', 'detail', 'source'], { pages: [] });
    queryClient.setQueryData(['folders', 'detail', 'destination'], { pages: [] });
    const unsubscribe = detailObserver.subscribe(() => undefined);
    try {
      await waitFor(() => expect(detailQuery).toHaveBeenCalledOnce());
      fetchMock.mockResolvedValue({ ok: true });
      const onSuccess = vi.fn();
      const { result } = renderHook(() => useBulkMovePages(), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate({ pageIds: ['p1'], parentId: 'destination' }, { onSuccess });
      });
      await waitFor(() => expect(detailQuery).toHaveBeenCalledTimes(2));
      expect(result.current.isPending).toBe(true);
      expect(onSuccess).not.toHaveBeenCalled();

      await act(async () => {
        finishRefresh?.({ parentId: 'destination' });
        await refresh;
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(onSuccess).toHaveBeenCalledOnce();
      expect(queryClient.getQueryData(['pages', 'detail', 'p1'])).toEqual({
        parentId: 'destination',
      });
      expect(queryClient.getQueryState(['pages', 'detail', 'unrelated'])?.isInvalidated).toBe(
        false,
      );
      for (const folderId of ['source', 'destination']) {
        expect(queryClient.getQueryState(['folders', 'detail', folderId])?.isInvalidated).toBe(
          true,
        );
      }
    } finally {
      unsubscribe();
    }
  });

  it('waits for late successful moves before refreshing a partially failed batch', async () => {
    let finishSecondMove: ((response: { ok: boolean }) => void) | undefined;
    const secondMove = new Promise<{ ok: boolean }>((resolve) => {
      finishSecondMove = resolve;
    });
    fetchMock.mockResolvedValueOnce({ ok: false }).mockReturnValueOnce(secondMove);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useBulkMovePages(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ pageIds: ['p1', 'p2'], parentId: 'destination' });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.isPending).toBe(true);
    expect(invalidateSpy).not.toHaveBeenCalled();

    await act(async () => {
      finishSecondMove?.({ ok: true });
      await secondMove;
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toastMocks.showSuccessToast).not.toHaveBeenCalled();
    for (const pageId of ['p1', 'p2']) {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['pages', 'detail', pageId],
        exact: true,
      });
    }
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['folders', 'detail'] });
  });

  it('reports a partial move failure without a false success message', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fetchMock.mockResolvedValueOnce({ ok: true });
    fetchMock.mockResolvedValueOnce({ ok: false });

    const { result } = renderHook(() => useBulkMovePages(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ pageIds: ['p1', 'p2'], parentId: 'f1' });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toastMocks.showSuccessToast).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pageTree'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shared-with-me'] });
  });

  it('moves pages to root (null parent)', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useBulkMovePages(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ pageIds: ['p1'], parentId: null });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.parentId).toBeNull();
  });
});

describe('useBulkMoveFolders', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it('moves multiple folders', async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useBulkMoveFolders(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ folderIds: ['f1', 'f2'], parentId: 'f-parent' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/folders/f1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ parentId: 'f-parent' }),
      }),
    );
  });

  it('refreshes folder contents and descendant page details when a folder moves', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    queryClient.setQueryData(['folders', 'detail', 'source'], { folders: [] });
    queryClient.setQueryData(['folders', 'detail', 'destination'], { folders: [] });
    queryClient.setQueryData(['folders', 'detail', 'nested-folder'], { parentId: 'f1' });
    queryClient.setQueryData(['pages', 'detail', 'nested-page'], { parentId: 'nested-folder' });
    const { result } = renderHook(() => useBulkMoveFolders(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ folderIds: ['f1'], parentId: 'destination' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    for (const folderId of ['source', 'destination', 'nested-folder']) {
      expect(queryClient.getQueryState(['folders', 'detail', folderId])?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(['pages', 'detail', 'nested-page'])?.isInvalidated).toBe(true);
  });
});
