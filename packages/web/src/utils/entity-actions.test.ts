import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFolderTreeNode, createMockPageTreeNode } from '../test-utils/factories';
import { createTestQueryClient, createWrapper } from '../test-utils/wrapper';
import { consumeSelfLeave } from './leave-page';

const toastMocks = vi.hoisted(() => ({
  showSuccessToast: vi.fn(),
}));

vi.mock('./toast', () => ({
  showSuccessToast: toastMocks.showSuccessToast,
  showErrorToast: vi.fn(),
  showInfoToast: vi.fn(),
}));

import {
  canAdministerEntity,
  canMoveEntity,
  canRemoveEntityFromView,
  canRenameEntity,
  resolveRemovalShareSource,
  useEntityDeletion,
} from './entity-actions';

describe('canMoveEntity', () => {
  it.each([
    ['admin', true, true],
    ['admin', false, false],
    ['edit', true, false],
    ['view', true, false],
    [null, true, false],
    [undefined, true, false],
  ] as const)('requires item and source administration (%s, %s)', (permission, sourceIsAdmin, expected) => {
    expect(canMoveEntity(permission, sourceIsAdmin)).toBe(expected);
  });
});

describe('canRenameEntity', () => {
  it.each([
    ['owner page', { type: 'page' as const, ownerId: 'user-1' }, true],
    ['owner folder', { type: 'folder' as const, ownerId: 'user-1' }, true],
    ['editable page', { type: 'page' as const, userPermission: 'edit' as const }, true],
    ['editable folder', { type: 'folder' as const, userPermission: 'edit' as const }, false],
    ['admin folder', { type: 'folder' as const, userPermission: 'admin' as const }, true],
    ['view-only page', { type: 'page' as const, userPermission: 'view' as const }, false],
  ])('%s has the expected rename capability', (_label, entity, expected) => {
    expect(canRenameEntity(entity, 'user-1')).toBe(expected);
  });

  it('fails closed when no current user is resolved', () => {
    expect(canRenameEntity({ type: 'page', userPermission: 'admin' }, undefined)).toBe(false);
  });
});

describe('canAdministerEntity', () => {
  it('allows owners and entity admins', () => {
    expect(canAdministerEntity({ ownerId: 'user-1' }, 'user-1')).toBe(true);
    expect(canAdministerEntity({ ownerId: 'owner', userPermission: 'admin' }, 'user-1')).toBe(true);
    expect(canAdministerEntity({ ownerId: 'owner', userPermission: 'edit' }, 'user-1')).toBe(false);
  });
});

describe('canRemoveEntityFromView', () => {
  it.each(['direct', 'public'] as const)('allows removal of %s shares', (shareSource) => {
    expect(canRemoveEntityFromView({ ownerId: 'owner', shareSource }, 'user-1')).toBe(true);
  });

  it('rejects inherited access and the owner', () => {
    expect(canRemoveEntityFromView({ ownerId: 'owner', shareSource: 'workspace' }, 'user-1')).toBe(
      false,
    );
    expect(canRemoveEntityFromView({ ownerId: 'user-1', shareSource: 'direct' }, 'user-1')).toBe(
      false,
    );
  });
});

describe('resolveRemovalShareSource', () => {
  it('hides personal removal when workspace access would remain after a direct grant is removed', () => {
    expect(resolveRemovalShareSource('direct', true)).toBe('workspace');
    expect(resolveRemovalShareSource('public', true)).toBe('workspace');
  });

  it('preserves directly removable provenance without workspace inheritance', () => {
    expect(resolveRemovalShareSource('direct', false)).toBe('direct');
    expect(resolveRemovalShareSource('public', false)).toBe('public');
  });
});

describe('useEntityDeletion', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    toastMocks.showSuccessToast.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it('does not report deletion success while a folder awaits confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () =>
          Promise.resolve({
            code: 'FOLDER_NOT_EMPTY',
            requiresForce: true,
            childFolders: 1,
            childPages: 2,
            message: 'Folder is not empty',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ deleted: true }),
      });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () => useEntityDeletion({ entityType: 'folder', currentUserId: 'owner-1', onSuccess }),
      { wrapper: createWrapper(queryClient) },
    );

    let initialResult: unknown;
    await act(async () => {
      initialResult = await result.current.moveToTrash({
        id: 'folder-1',
        type: 'folder',
        title: 'Project',
        ownerId: 'owner-1',
      });
    });

    expect(initialResult).toEqual(
      expect.objectContaining({ requiresForce: true, childFolders: 1, childPages: 2 }),
    );
    expect(toastMocks.showSuccessToast).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.moveToTrash(
        { id: 'folder-1', type: 'folder', title: 'Project', ownerId: 'owner-1' },
        { force: true },
      );
    });

    expect(fetchMock).toHaveBeenLastCalledWith('/api/folders/folder-1?force=true', {
      method: 'DELETE',
    });
    expect(toastMocks.showSuccessToast).toHaveBeenCalledWith('Moved "Project" To Trash');
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('does not report success for an undecodable delete response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(
      () => useEntityDeletion({ entityType: 'page', currentUserId: 'owner-1' }),
      { wrapper: createWrapper(queryClient) },
    );

    await expect(
      result.current.moveToTrash({
        id: 'page-1',
        type: 'page',
        title: 'Broken page',
        ownerId: 'owner-1',
      }),
    ).rejects.toThrow('Invalid delete page response');
    expect(toastMocks.showSuccessToast).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('does not report success when a delete response omits its result', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    const { result } = renderHook(
      () => useEntityDeletion({ entityType: 'page', currentUserId: 'owner-1' }),
      { wrapper: createWrapper(queryClient) },
    );

    await expect(
      result.current.moveToTrash({
        id: 'page-1',
        type: 'page',
        title: 'Broken page',
        ownerId: 'owner-1',
      }),
    ).rejects.toThrow('Invalid delete page response');
    expect(toastMocks.showSuccessToast).not.toHaveBeenCalled();
  });

  it('removes a confirmed page deletion from navigation caches before reporting success', async () => {
    const deleted = createMockPageTreeNode({ id: 'page-1' });
    const remaining = createMockPageTreeNode({ id: 'page-2' });
    queryClient.setQueryData(['pageTree'], [deleted, remaining]);
    queryClient.setQueryData(
      ['pages', 'recent', 8],
      [
        { id: 'page-1', title: 'Deleted' },
        { id: 'page-2', title: 'Remaining' },
      ],
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deleted: true }),
    });
    const onSuccess = vi.fn(() => {
      expect(queryClient.getQueryData(['pageTree'])).toEqual([remaining]);
    });
    const { result } = renderHook(
      () => useEntityDeletion({ entityType: 'page', currentUserId: 'owner-1', onSuccess }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.moveToTrash({
        id: 'page-1',
        type: 'page',
        title: 'Deleted',
        ownerId: 'owner-1',
      });
    });

    expect(queryClient.getQueryData(['pageTree'])).toEqual([remaining]);
    expect(queryClient.getQueryData(['pages', 'recent', 8])).toEqual([
      { id: 'page-2', title: 'Remaining' },
    ]);
    expect(consumeSelfLeave('page-1')).toBe(true);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it.each([
    'trash',
    'remove',
  ] as const)('keeps cache updates and feedback but skips screen callbacks after unmounting (%s)', async (action) => {
    queryClient.setQueryData(['pageTree'], [createMockPageTreeNode({ id: 'page-1' })]);
    let finishRequest: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        finishRequest = resolve;
      }),
    );
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(
      () => useEntityDeletion({ entityType: 'page', currentUserId: 'admin-1', onSuccess }),
      { wrapper: createWrapper(queryClient) },
    );
    const entity = {
      id: 'page-1',
      type: 'page' as const,
      title: 'Shared page',
      ownerId: 'owner-1',
      userPermission: 'admin' as const,
      shareSource: 'direct' as const,
    };
    let removal: Promise<unknown> | undefined;
    act(() => {
      removal =
        action === 'trash'
          ? result.current.moveToTrash(entity)
          : result.current.removeFromView(entity);
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    unmount();

    await act(async () => {
      finishRequest?.(
        new Response(JSON.stringify(action === 'trash' ? { deleted: true } : { ok: true })),
      );
      await removal;
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['pageTree'])).toEqual([]);
    expect(toastMocks.showSuccessToast).toHaveBeenCalledOnce();
  });

  it.each([
    ['trash', false],
    ['trash', true],
    ['remove', false],
    ['remove', true],
  ] as const)('uses the latest callback for a still-mounted %s action (active: %s)', async (action, active) => {
    let finishRequest: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        finishRequest = resolve;
      }),
    );
    const initialCallback = vi.fn();
    const latestCallback = vi.fn();
    const initialProps: { onSuccess: (() => void) | undefined } = {
      onSuccess: initialCallback,
    };
    const { result, rerender } = renderHook(
      ({ onSuccess }: { onSuccess: (() => void) | undefined }) =>
        useEntityDeletion({ entityType: 'page', currentUserId: 'admin-1', onSuccess }),
      {
        initialProps,
        wrapper: createWrapper(queryClient),
      },
    );
    const entity = {
      id: 'page-1',
      type: 'page' as const,
      title: 'Shared page',
      ownerId: 'owner-1',
      userPermission: 'admin' as const,
      shareSource: 'direct' as const,
    };
    let removal: Promise<unknown> | undefined;
    act(() => {
      removal =
        action === 'trash'
          ? result.current.moveToTrash(entity)
          : result.current.removeFromView(entity);
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    rerender({ onSuccess: active ? latestCallback : undefined });

    await act(async () => {
      finishRequest?.(
        new Response(JSON.stringify(action === 'trash' ? { deleted: true } : { ok: true })),
      );
      await removal;
    });

    expect(initialCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledTimes(active ? 1 : 0);
  });

  it('removes a confirmed folder subtree and its pages from navigation caches', async () => {
    const childFolder = createMockFolderTreeNode({ id: 'folder-child', parentId: 'folder-1' });
    const deletedFolder = createMockFolderTreeNode({
      id: 'folder-1',
      children: [childFolder],
    });
    const childPage = createMockPageTreeNode({ id: 'page-1', parentId: childFolder.id });
    const remainingPage = createMockPageTreeNode({ id: 'page-2' });
    queryClient.setQueryData(['folderTree'], [deletedFolder]);
    queryClient.setQueryData(['pageTree'], [childPage, remainingPage]);
    queryClient.setQueryData(
      ['pages', 'recent', 8],
      [
        { id: 'page-1', title: 'Deleted' },
        { id: 'page-2', title: 'Remaining' },
      ],
    );
    queryClient.setQueryData(
      ['stars'],
      [
        { entityType: 'folder', entityId: 'folder-child', title: 'Child folder' },
        { entityType: 'page', entityId: 'page-1', title: 'Child page' },
      ],
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deleted: true }),
    });
    const { result } = renderHook(
      () => useEntityDeletion({ entityType: 'folder', currentUserId: 'owner-1' }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.moveToTrash(
        { id: 'folder-1', type: 'folder', title: 'Project', ownerId: 'owner-1' },
        { force: true },
      );
    });

    expect(queryClient.getQueryData(['folderTree'])).toEqual([]);
    expect(queryClient.getQueryData(['pageTree'])).toEqual([remainingPage]);
    expect(queryClient.getQueryData(['pages', 'recent', 8])).toEqual([
      { id: 'page-2', title: 'Remaining' },
    ]);
    expect(queryClient.getQueryData(['stars'])).toEqual([]);
  });

  it('clears self-leave coordination when a direct page leave fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Leave failed' }),
    });
    const { result } = renderHook(
      () => useEntityDeletion({ entityType: 'page', currentUserId: 'user-1' }),
      { wrapper: createWrapper(queryClient) },
    );

    await expect(
      result.current.removeFromView({
        id: 'shared-page',
        type: 'page',
        title: 'Shared page',
        ownerId: 'owner-1',
        userPermission: 'view',
        shareSource: 'direct',
      }),
    ).rejects.toThrow('Leave failed');

    expect(consumeSelfLeave('shared-page')).toBe(false);
  });

  it('uses personal removal for a directly shared non-owner admin', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () => useEntityDeletion({ entityType: 'page', currentUserId: 'admin-1', onSuccess }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.removeFromView({
        id: 'shared-page',
        type: 'page',
        title: 'Shared roadmap',
        ownerId: 'owner-1',
        userPermission: 'admin',
        shareSource: 'direct',
      });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/pages/shared-page/leave', { method: 'POST' });
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/pages/shared-page',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(toastMocks.showSuccessToast).toHaveBeenCalledWith(
      '“Shared roadmap” removed from your view',
    );
    expect(consumeSelfLeave('shared-page')).toBe(true);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('keeps the explicit trash action available to a non-owner admin', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deleted: true }),
    });
    const { result } = renderHook(
      () => useEntityDeletion({ entityType: 'page', currentUserId: 'admin-1' }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.moveToTrash({
        id: 'shared-page',
        type: 'page',
        title: 'Shared roadmap',
        ownerId: 'owner-1',
        userPermission: 'admin',
        shareSource: 'direct',
      });
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/pages/shared-page', { method: 'DELETE' });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/pages/shared-page/leave', { method: 'POST' });
    expect(toastMocks.showSuccessToast).toHaveBeenCalledWith('Moved "Shared roadmap" To Trash');
    expect(consumeSelfLeave('shared-page')).toBe(true);
  });

  it('rejects personal removal for workspace-inherited access without a request', async () => {
    const { result } = renderHook(
      () => useEntityDeletion({ entityType: 'page', currentUserId: 'admin-1' }),
      { wrapper: createWrapper(queryClient) },
    );

    await expect(
      result.current.removeFromView({
        id: 'workspace-page',
        type: 'page',
        title: 'Workspace page',
        ownerId: 'owner-1',
        userPermission: 'admin',
        shareSource: 'workspace',
      }),
    ).rejects.toThrow('inherits access and cannot be removed directly');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
