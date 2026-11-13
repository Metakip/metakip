import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, createWrapper } from '../test-utils/wrapper';
import { useFolderCollaborators, usePageCollaborators } from './use-page-collaborators';

function entityIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
  );
}

function requestedIds(url: string): string[] {
  return new URL(url, 'http://localhost').searchParams.get('ids')?.split(',') ?? [];
}

describe('collaborator display queries', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    fetchMock = vi.fn((url: string) => {
      const ids = requestedIds(url);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(Object.fromEntries(ids.map((id) => [id, []]))),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it.each([
    ['page', usePageCollaborators],
    ['folder', useFolderCollaborators],
  ] as const)('normalizes duplicate %s IDs for requests and query identity', async (_, useCollaborators) => {
    const { result, rerender } = renderHook(({ ids }) => useCollaborators(ids), {
      initialProps: { ids: ['b', 'a', 'b'] },
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedIds(String(fetchMock.mock.calls[0]?.[0]))).toEqual(['a', 'b']);

    rerender({ ids: ['a', 'b'] });

    expect(result.current.isSuccess).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads more than 100 page collaborator lists as one merged query result', async () => {
    const ids = entityIds(205);
    const { result } = renderHook(() => usePageCollaborators(ids), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => requestedIds(String(url)).length)).toEqual([
      100, 100, 5,
    ]);
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).includes('/pages/collaborators?')),
    ).toBe(true);
    expect(Object.keys(result.current.data ?? {})).toHaveLength(205);
  });

  it('chunks folder collaborator lists through the folder endpoint', async () => {
    const ids = entityIds(101);
    const { result } = renderHook(() => useFolderCollaborators(ids), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => requestedIds(String(url)).length)).toEqual([100, 1]);
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).includes('/folders/collaborators?')),
    ).toBe(true);
    expect(Object.keys(result.current.data ?? {})).toHaveLength(101);
  });
});
