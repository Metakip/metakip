import type {
  AccountPagePayload,
  FolderTreeNode,
  PageTreeNode,
  SharedNavigationItem,
  WorkspaceMembership,
} from '@metakip/shared';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFolderTreeNode, createMockPageTreeNode } from '../test-utils/factories';

type Snapshot<T> = { isSuccess: true; data: T } | { isSuccess: false; data: T | undefined };

const mocks = vi.hoisted(() => ({
  pages: { isSuccess: true, data: [] } as Snapshot<PageTreeNode[]>,
  shared: { isSuccess: true, data: [] } as Snapshot<SharedNavigationItem[]>,
  folders: { isSuccess: true, data: [] } as Snapshot<FolderTreeNode[]>,
  memberships: { isSuccess: true, data: [] } as Snapshot<
    Pick<WorkspaceMembership, 'ownerId' | 'role'>[]
  >,
}));

vi.mock('./useAuth', () => ({
  useAuth: () => ({ data: { user: { id: 'current-user' } } }),
}));
vi.mock('./use-pages', () => ({ usePageTree: () => mocks.pages }));
vi.mock('./use-shared-with-me', () => ({ useSharedWithMeTree: () => mocks.shared }));
vi.mock('./use-folders', () => ({ useFolderTree: () => mocks.folders }));
vi.mock('./use-workspace', () => ({ useWorkspaceMemberships: () => mocks.memberships }));

import { usePageActionEligibility } from './usePageActionEligibility';

const page: AccountPagePayload = {
  accessScope: 'account',
  id: 'page-1',
  title: 'Test page',
  icon: null,
  parentId: 'folder-1',
  ownerId: 'owner-1',
  createdBy: 'owner-1',
  createdAt: null,
  updatedAt: null,
  coverType: null,
  coverValue: null,
  position: 'a0',
  properties: null,
  inheritancePolicy: 'inherit',
  publicPermission: null,
  userPermission: 'admin',
  capabilities: { canEdit: true, canComment: true, canDelete: true, canCopy: true },
};

function sharedPage(source?: 'direct' | 'public'): SharedNavigationItem {
  return {
    entityType: 'page',
    id: page.id,
    title: page.title,
    icon: null,
    parentId: page.parentId,
    ownerId: page.ownerId,
    createdBy: page.createdBy,
    updatedAt: null,
    userPermission: 'admin',
    ...(source ? { source } : {}),
  };
}

describe('page action eligibility', () => {
  beforeEach(() => {
    mocks.pages = { isSuccess: true, data: [] };
    mocks.shared = { isSuccess: true, data: [] };
    mocks.folders = { isSuccess: true, data: [] };
    mocks.memberships = { isSuccess: true, data: [] };
  });

  it.each([
    'direct',
    'public',
  ] as const)('resolves %s removal only after both navigation queries succeed', (source) => {
    mocks.shared = { isSuccess: true, data: [sharedPage(source)] };
    mocks.pages = { isSuccess: false, data: undefined };
    const { result, rerender } = renderHook(() => usePageActionEligibility(page, 'view', true));
    expect(result.current.removal).toEqual({ status: 'unresolved' });

    mocks.pages = { isSuccess: true, data: [] };
    rerender();
    expect(result.current.removal).toEqual({ status: 'ready', shareSource: source });

    mocks.pages = {
      isSuccess: true,
      data: [createMockPageTreeNode({ id: page.id, workspaceAccess: true })],
    };
    rerender();
    expect(result.current.removal).toEqual({ status: 'ready', shareSource: 'workspace' });
  });

  it('does not use stale navigation data after a failed query', () => {
    mocks.shared = { isSuccess: true, data: [sharedPage('direct')] };
    mocks.pages = { isSuccess: false, data: [] };
    const { result } = renderHook(() => usePageActionEligibility(page, 'view', true));
    expect(result.current.removal).toEqual({ status: 'unresolved' });
  });

  it('waits for shared navigation rather than equating its absence with denied removal', () => {
    mocks.shared = { isSuccess: false, data: undefined };
    const { result } = renderHook(() => usePageActionEligibility(page, 'view', true));
    expect(result.current.removal).toEqual({ status: 'unresolved' });
  });

  it('does not infer personal removal from an ancestor folder share', () => {
    mocks.shared = {
      isSuccess: true,
      data: [
        {
          entityType: 'folder',
          id: 'folder-1',
          title: 'Shared folder',
          icon: null,
          parentId: null,
          ownerId: page.ownerId,
          createdBy: page.createdBy,
          updatedAt: null,
          userPermission: 'admin',
          source: 'direct',
          children: [sharedPage()],
        },
      ],
    };
    const { result } = renderHook(() => usePageActionEligibility(page, 'view', true));
    expect(result.current.removal).toEqual({ status: 'ready', shareSource: undefined });
  });

  it.each([
    'view',
    'edit',
    'admin',
  ] as const)('checks source-folder administration, not just page administration (source: %s)', (sourcePermission) => {
    mocks.folders = {
      isSuccess: true,
      data: [
        createMockFolderTreeNode({
          id: 'ancestor',
          children: [
            createMockFolderTreeNode({ id: 'folder-1', userPermission: sourcePermission }),
          ],
        }),
      ],
    };
    const { result } = renderHook(() => usePageActionEligibility(page, 'admin', true));
    expect(result.current.move).toBe(sourcePermission === 'admin' ? 'allowed' : 'denied');
  });

  it('keeps Move unresolved while source-folder permissions load or fail', () => {
    mocks.folders = { isSuccess: false, data: undefined };
    const { result } = renderHook(() => usePageActionEligibility(page, 'admin', true));
    expect(result.current.move).toBe('unresolved');
  });

  it('does not offer Move when the source folder is absent from resolved navigation', () => {
    const { result } = renderHook(() => usePageActionEligibility(page, 'admin', true));
    expect(result.current.move).toBe('denied');
  });

  it.each([
    'viewer',
    'editor',
    'admin',
  ] as const)('checks administration of the source workspace (role: %s)', (role) => {
    mocks.pages = {
      isSuccess: true,
      data: [createMockPageTreeNode({ id: page.id, workspaceAccess: true })],
    };
    mocks.memberships = { isSuccess: true, data: [{ ownerId: 'owner-1', role }] };
    const { result } = renderHook(() =>
      usePageActionEligibility({ ...page, parentId: null }, 'admin', true),
    );
    expect(result.current.move).toBe(role === 'admin' ? 'allowed' : 'denied');
  });

  it('allows a root page move from the source workspace admin grant', () => {
    mocks.memberships = { isSuccess: true, data: [{ ownerId: 'owner-1', role: 'admin' }] };
    const { result } = renderHook(() =>
      usePageActionEligibility({ ...page, parentId: null }, 'admin', true),
    );
    expect(result.current.move).toBe('allowed');
  });

  it('does not use administration of a different workspace', () => {
    mocks.pages = {
      isSuccess: true,
      data: [createMockPageTreeNode({ id: page.id, workspaceAccess: true })],
    };
    mocks.memberships = { isSuccess: true, data: [{ ownerId: 'other-owner', role: 'admin' }] };
    const { result } = renderHook(() =>
      usePageActionEligibility({ ...page, parentId: null }, 'admin', true),
    );
    expect(result.current.move).toBe('denied');
  });

  it('waits for workspace membership data before offering Move', () => {
    mocks.memberships = { isSuccess: false, data: undefined };
    const { result } = renderHook(() =>
      usePageActionEligibility({ ...page, parentId: null }, 'admin', true),
    );
    expect(result.current.move).toBe('unresolved');
  });

  it('keeps owner actions available without unrelated navigation queries', () => {
    mocks.pages = { isSuccess: false, data: undefined };
    mocks.folders = { isSuccess: false, data: undefined };
    const { result } = renderHook(() =>
      usePageActionEligibility({ ...page, ownerId: 'current-user' }, 'admin', true),
    );
    expect(result.current.move).toBe('allowed');
  });

  it('honors a live page-permission downgrade even when source administration remains', () => {
    mocks.folders = {
      isSuccess: true,
      data: [createMockFolderTreeNode({ id: 'folder-1', userPermission: 'admin' })],
    };
    const { result, rerender } = renderHook(
      ({ permission }: { permission: 'admin' | 'edit' }) =>
        usePageActionEligibility(page, permission, true),
      { initialProps: { permission: 'admin' } },
    );
    expect(result.current.move).toBe('allowed');
    rerender({ permission: 'edit' });
    expect(result.current.move).toBe('denied');
  });
});
