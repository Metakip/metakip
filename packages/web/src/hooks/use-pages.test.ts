import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockFolderTreeNode,
  createMockPage,
  createMockPageTreeNode,
} from '../test-utils/factories';
import { createTestQueryClient, createWrapper } from '../test-utils/wrapper';

vi.mock('../utils/toast', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
  showInfoToast: vi.fn(),
}));

import { showSuccessToast } from '../utils/toast';

import {
  useCreatePage,
  useEmptyTrash,
  useImportMarkdown,
  usePages,
  usePageTree,
  usePermanentDeletePage,
  useRestorePage,
  useTrashPages,
  useUpdatePage,
} from './use-pages';

describe('usePageTree', () => {
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

  it('fetches page tree successfully', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: 'p1', title: 'Page 1', children: [] }]),
    });

    const { result } = renderHook(() => usePageTree(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([{ id: 'p1', title: 'Page 1', children: [] }]);
  });

  it('handles fetch error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    const { result } = renderHook(() => usePageTree(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('usePages', () => {
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

  it('flattens nested page tree into flat list', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            id: 'p1',
            title: 'Parent',
            children: [
              { id: 'p2', title: 'Child 1', children: [] },
              {
                id: 'p3',
                title: 'Child 2',
                children: [{ id: 'p4', title: 'Grandchild', children: [] }],
              },
            ],
          },
        ]),
    });

    const { result } = renderHook(() => usePages(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.data).toHaveLength(4);
    });

    const ids = result.current.data?.map((p) => p.id);
    expect(ids).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('returns empty array when no data', () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

    const { result } = renderHook(() => usePages(), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.data).toEqual([]);
  });
});

describe('useTrashPages', () => {
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

  it('fetches trash pages successfully', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: 'p1', title: 'Deleted', isDeleted: true }]),
    });

    const { result } = renderHook(() => useTrashPages(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([{ id: 'p1', title: 'Deleted', isDeleted: true }]);
  });
});

describe('useCreatePage', () => {
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

  it('creates a page successfully', async () => {
    const newPage = { id: 'p-new', title: 'My Page' };
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(newPage) });

    const { result } = renderHook(() => useCreatePage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ title: 'My Page' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ parentId: undefined, title: 'My Page' }),
      }),
    );
  });

  it('adds a confirmed page to the cached tree with its effective owner', async () => {
    const existing = createMockPageTreeNode({ id: 'existing', ownerId: 'user-1' });
    const created = createMockPage({ id: 'p-new', createdBy: 'user-1', title: 'My Page' });
    queryClient.setQueryData(['pageTree'], [existing]);
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(created) });

    const { result } = renderHook(() => useCreatePage(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ title: 'My Page' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(['pageTree'])).toEqual([
      expect.objectContaining({ id: 'p-new', ownerId: 'user-1', title: 'My Page' }),
      existing,
    ]);
  });

  it('inherits a parent folder owner when creating in another workspace', async () => {
    const parent = createMockFolderTreeNode({
      id: 'shared-folder',
      ownerId: 'owner-1',
      userPermission: 'edit',
      workspaceAccess: true,
    });
    const created = createMockPage({
      id: 'p-new',
      parentId: parent.id,
      createdBy: 'member-1',
    });
    queryClient.setQueryData(['folderTree'], [parent]);
    queryClient.setQueryData(['pageTree'], []);
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(created) });

    const { result } = renderHook(() => useCreatePage(), {
      wrapper: createWrapper(queryClient),
    });
    result.current.mutate({ parentId: parent.id });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(['pageTree'])).toEqual([
      expect.objectContaining({
        id: 'p-new',
        ownerId: 'owner-1',
        userPermission: 'edit',
        workspaceAccess: true,
      }),
    ]);
  });

  it('invalidates shared navigation after creating a page', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'p-new', title: 'My Page' }),
    });

    const { result } = renderHook(() => useCreatePage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ parentId: 'shared-folder', title: 'My Page' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shared-with-me'] });
  });

  it('suppresses success toast when silent option is set', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'p-new', title: 'My Page' }),
    });

    const { result } = renderHook(() => useCreatePage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ silent: true });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(showSuccessToast).not.toHaveBeenCalled();
  });

  it('handles creation error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Title required' }),
    });

    const { result } = renderHook(() => useCreatePage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({});

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toBe('Title required');
  });
});

describe('useUpdatePage', () => {
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

  it('updates page title', async () => {
    const updated = { id: 'p1', title: 'Updated Title' };
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(updated) });

    const { result } = renderHook(() => useUpdatePage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ pageId: 'p1', updates: { title: 'Updated Title' } });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pages/p1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated Title' }),
      }),
    );
  });

  it('updates cached properties immediately after a successful save', async () => {
    const page = createMockPageTreeNode({ id: 'p1', properties: null });
    queryClient.setQueryData(['pageTree'], [page]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ...page, properties: { tags: ['fresh-tag'] } }),
    });

    const { result } = renderHook(() => useUpdatePage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({
      pageId: 'p1',
      updates: { properties: { tags: ['fresh-tag'] } },
      silent: true,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(queryClient.getQueryData(['pageTree'])).toEqual([
      expect.objectContaining({ id: 'p1', properties: { tags: ['fresh-tag'] } }),
    ]);
  });

  it('suppresses success toast when silent option is set', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'p1', title: 'Updated' }),
    });

    const { result } = renderHook(() => useUpdatePage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ pageId: 'p1', updates: { title: 'Updated' }, silent: true });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(showSuccessToast).not.toHaveBeenCalled();
  });
});

describe('useRestorePage', () => {
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

  it('restores a trashed page', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'p1', title: 'Restored' }),
    });

    const { result } = renderHook(() => useRestorePage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('p1');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pages/p1/restore',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['favorites'] });
  });
});

describe('usePermanentDeletePage', () => {
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

  it('permanently deletes a page', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => usePermanentDeletePage(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate('p1');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pages/p1/permanent',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('useEmptyTrash', () => {
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

  it('empties trash', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useEmptyTrash(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate();

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pages/trash/empty-all',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('useImportMarkdown', () => {
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

  it('imports markdown file', async () => {
    const file = new File(['# Hello'], 'test.md', { type: 'text/markdown' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ page: { id: 'p-new', title: 'test' }, warnings: [] }),
    });

    const { result } = renderHook(() => useImportMarkdown(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ file });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const call = fetchMock.mock.calls[0] as [string, { method: string; body: FormData }];
    expect(call[0]).toBe('/api/import/markdown');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.body instanceof FormData).toBe(true);
  });
});
