import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, createWrapper } from '../test-utils/wrapper';

vi.mock('../utils/toast', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
  showInfoToast: vi.fn(),
}));

import { useStars, useToggleStar } from './use-stars';

describe('useStars', () => {
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

  it('fetches stars successfully', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          stars: [
            {
              entityType: 'page',
              entityId: 'p1',
              title: 'Page 1',
              icon: null,
              createdAt: null,
            },
          ],
        }),
    });

    const { result } = renderHook(() => useStars(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([
      {
        entityType: 'page',
        entityId: 'p1',
        title: 'Page 1',
        icon: null,
        createdAt: null,
      },
    ]);
  });

  it('handles fetch error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    const { result } = renderHook(() => useStars(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it('stars an item when it is not already starred', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useToggleStar(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        entityType: 'folder',
        entityId: 'f1',
        title: 'Folder 1',
        icon: null,
        isStarred: false,
      });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/stars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'folder', entityId: 'f1' }),
    });
  });

  it('unstars an item when it is already starred', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useToggleStar(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        entityType: 'folder',
        entityId: 'f1',
        isStarred: true,
      });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/stars/folder/f1', {
      method: 'DELETE',
    });
  });
});
