import type { FolderTreeNode, PageTreeNode, SharedNavigationItem } from '@metakip/shared';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceMembership } from '../../hooks/use-workspace';
import { createMockFolderTreeNode, createMockPageTreeNode } from '../../test-utils/factories';
import { render } from '../../test-utils/render';

const mocks = vi.hoisted(() => ({
  pages: [] as PageTreeNode[] | undefined,
  pagesPending: false,
  pagesFetching: false,
  pagesFetchStatus: 'idle' as 'fetching' | 'paused' | 'idle',
  folders: [] as FolderTreeNode[] | undefined,
  foldersPending: false,
  foldersFetching: false,
  foldersFetchStatus: 'idle' as 'fetching' | 'paused' | 'idle',
  shared: [] as SharedNavigationItem[],
  memberships: [] as WorkspaceMembership[],
  leaveWorkspace: vi.fn(),
  updatePage: vi.fn(),
  capturedRenameSave: null as (() => void) | null,
}));

vi.mock('../../contexts/ShareContext', () => ({
  useShareContext: () => ({ isAnonymous: false }),
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ data: { user: { id: 'current-user' } } }),
}));
vi.mock('../../hooks/use-favorites', () => ({
  useFavorites: () => ({ data: [] }),
}));
vi.mock('../../hooks/use-folders', () => ({
  useFolderTree: () => ({
    data: mocks.folders,
    isPending: mocks.foldersPending,
    isFetching: mocks.foldersFetching,
    fetchStatus: mocks.foldersFetchStatus,
    error: null,
  }),
  useCreateFolder: () => ({ mutateAsync: vi.fn() }),
  useUpdateFolder: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../hooks/use-pages', () => ({
  usePageTree: () => ({
    data: mocks.pages,
    isPending: mocks.pagesPending,
    isFetching: mocks.pagesFetching,
    fetchStatus: mocks.pagesFetchStatus,
    error: null,
  }),
  useRecentPages: () => ({ data: [] }),
  useCreatePage: () => ({ mutateAsync: vi.fn() }),
  useUpdatePage: () => ({ mutate: mocks.updatePage, mutateAsync: vi.fn() }),
  useImportMarkdown: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../hooks/use-shared-with-me', () => ({
  useSharedWithMeTree: () => ({ data: mocks.shared }),
}));
vi.mock('../../hooks/use-workspace', () => ({
  useWorkspaceMemberships: () => ({ data: mocks.memberships }),
  useLeaveWorkspace: () => ({ mutate: mocks.leaveWorkspace, isPending: false }),
}));
vi.mock('../../utils/entity-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/entity-actions')>()),
  useEntityDeletion: () => ({
    moveToTrash: vi.fn(),
    removeFromView: vi.fn(),
    isPending: false,
  }),
}));
vi.mock('./PageTreeRow', () => ({
  PageTreeRow: ({
    title,
    onRename,
    isEditing,
    editTitle,
    onEditChange,
    onEditSave,
    userPermission,
  }: {
    title: string;
    onRename?: () => void;
    isEditing?: boolean;
    editTitle?: string;
    onEditChange?: (value: string) => void;
    onEditSave?: () => void;
    userPermission?: 'view' | 'edit' | 'admin' | null;
  }) => {
    if (isEditing && onEditSave) mocks.capturedRenameSave = onEditSave;
    return (
      <div>
        <span data-testid={`sidebar-permission-${title}`}>{userPermission ?? 'none'}</span>
        {isEditing ? (
          <input
            aria-label={`Rename ${title}`}
            value={editTitle}
            onChange={(event) => onEditChange?.(event.target.value)}
            onBlur={onEditSave}
          />
        ) : (
          <span>{title}</span>
        )}
        {onRename && (
          <button type="button" onClick={onRename}>
            Rename {title}
          </button>
        )}
      </div>
    );
  },
}));

import { PageTree } from './PageTree';

function membership(ownerId: string, ownerName: string): WorkspaceMembership {
  return {
    ownerId,
    ownerName,
    role: 'viewer',
    joinedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('PageTree workspace navigation', () => {
  beforeEach(() => {
    mocks.pages = [];
    mocks.pagesPending = false;
    mocks.pagesFetching = false;
    mocks.pagesFetchStatus = 'idle';
    mocks.folders = [];
    mocks.foldersPending = false;
    mocks.foldersFetching = false;
    mocks.foldersFetchStatus = 'idle';
    mocks.shared = [];
    mocks.memberships = [];
    mocks.leaveWorkspace.mockReset();
    mocks.updatePage.mockReset();
    mocks.capturedRenameSave = null;
  });

  it('shows a loading indicator while the page tree is pending', () => {
    mocks.pages = undefined;
    mocks.pagesPending = true;
    mocks.pagesFetching = true;
    mocks.pagesFetchStatus = 'fetching';

    render(<PageTree />);

    expect(screen.getByRole('status', { name: 'Loading sidebar' })).toBeInTheDocument();
  });

  it('groups visible workspace content under Shared With Me', () => {
    mocks.memberships = [membership('workspace-1', 'Alice')];
    mocks.pages = [
      createMockPageTreeNode({
        id: 'workspace-page',
        title: 'Workspace page',
        ownerId: 'workspace-1',
        workspaceAccess: true,
      }),
    ];

    render(<PageTree />);

    expect(screen.getByText('Shared With Me')).toBeInTheDocument();
    expect(screen.getByText("Alice's Workspace")).toBeInTheDocument();
    expect(screen.getByText('Workspace page')).toBeInTheDocument();
  });

  it('keeps an empty joined workspace visible with a leave action', () => {
    mocks.memberships = [membership('workspace-1', 'Alice')];

    render(<PageTree />);

    expect(screen.getByText('Shared With Me')).toBeInTheDocument();
    expect(screen.getByText("Alice's Workspace")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave Alice' })).toBeInTheDocument();
  });

  it('keeps a fully restricted workspace visible without exposing restricted names', () => {
    mocks.memberships = [membership('workspace-1', 'Alice')];
    mocks.pages = [
      createMockPageTreeNode({
        id: 'restricted-page',
        title: 'Secret roadmap',
        ownerId: 'workspace-1',
        workspaceAccess: false,
      }),
    ];
    mocks.folders = [
      createMockFolderTreeNode({
        id: 'restricted-folder',
        name: 'Secret folder',
        ownerId: 'workspace-1',
        workspaceAccess: false,
      }),
    ];

    render(<PageTree />);

    expect(screen.getByText("Alice's Workspace")).toBeInTheDocument();
    expect(screen.queryByText('Secret roadmap')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret folder')).not.toBeInTheDocument();
  });

  it('renders separate groups for multiple joined workspaces', () => {
    mocks.memberships = [membership('workspace-1', 'Alice'), membership('workspace-2', 'Bob')];

    render(<PageTree />);

    expect(screen.getByText("Alice's Workspace")).toBeInTheDocument();
    expect(screen.getByText("Bob's Workspace")).toBeInTheDocument();
  });

  it('leaves an empty workspace from its workspace-level control', async () => {
    const user = userEvent.setup();
    mocks.memberships = [membership('workspace-1', 'Alice')];
    render(<PageTree />);

    await user.click(screen.getByRole('button', { name: 'Leave Alice' }));

    expect(mocks.leaveWorkspace).toHaveBeenCalledWith({
      ownerId: 'workspace-1',
      memberId: 'current-user',
    });
  });

  it('cancels an active rename when edit access downgrades to view', async () => {
    const user = userEvent.setup();
    mocks.memberships = [membership('workspace-1', 'Alice')];
    const editablePage = createMockPageTreeNode({
      id: 'workspace-page',
      title: 'Workspace page',
      ownerId: 'workspace-1',
      workspaceAccess: true,
      userPermission: 'edit',
    });
    mocks.pages = [editablePage];
    const rendered = render(<PageTree />);

    await user.click(screen.getByRole('button', { name: 'Rename Workspace page' }));
    expect(screen.getByRole('textbox', { name: 'Rename Workspace page' })).toBeInTheDocument();
    const staleSave = mocks.capturedRenameSave;
    expect(staleSave).not.toBeNull();

    mocks.pages = [{ ...editablePage, userPermission: 'view' }];
    rendered.rerender(<PageTree />);

    expect(screen.queryByRole('textbox', { name: 'Rename Workspace page' })).toBeNull();
    act(() => staleSave?.());
    expect(mocks.updatePage).not.toHaveBeenCalled();
  });

  it('uses the canonical page-tree permission when shared navigation is stale', () => {
    mocks.pages = [
      createMockPageTreeNode({
        id: 'shared-page',
        title: 'Canonical title',
        ownerId: 'workspace-1',
        userPermission: 'edit',
      }),
    ];
    mocks.shared = [
      {
        entityType: 'page',
        id: 'shared-page',
        title: 'Canonical title',
        icon: null,
        parentId: null,
        ownerId: 'workspace-1',
        createdBy: 'workspace-1',
        updatedAt: null,
        userPermission: 'view',
        source: 'direct',
      },
    ];

    render(<PageTree />);

    expect(screen.getByRole('button', { name: 'Rename Canonical title' })).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-permission-Canonical title')).toHaveTextContent('edit');
  });
});
