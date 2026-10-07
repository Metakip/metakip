import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFolderPath } from '../utils/url';

const FOLDER_ID = '11111111-1111-4111-8111-111111111111';
const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  refetchPages: vi.fn(),
  refetchFolders: vi.fn(),
  pagesPending: false,
  pagesFetching: false,
  pagesFetchStatus: 'idle' as 'fetching' | 'paused' | 'idle',
  foldersPending: false,
  foldersFetching: false,
  foldersFetchStatus: 'idle' as 'fetching' | 'paused' | 'idle',
  pagesError: new Error('page tree failed') as Error | null,
  foldersError: new Error('folder tree failed') as Error | null,
  folderTree: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      parentId: null,
      name: 'Stale tree name',
      icon: null,
      position: 'a0',
      createdBy: 'owner-1',
      ownerId: 'owner-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      publicPermission: null,
      children: [],
    },
  ],
  clipboardState: { action: null, items: [] } as {
    action: 'copy' | 'cut' | null;
    items: Array<{ id: string; type: 'page' | 'folder' }>;
  },
  share: {
    capabilities: { canEdit: true, canDelete: true, canCopy: true, canComment: true },
    isAnonymous: false,
    publicEntity: {
      accessScope: 'account' as const,
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Fresh polled name',
      parentId: null,
      publicPermission: 'edit' as const,
      folders: [] as Array<{
        accessScope: 'public' | 'account';
        id: string;
        name: string;
        icon: string | null;
        updatedAt: string | null;
        publicPermission: 'view' | 'edit';
        createdBy?: string | null;
        ownerId?: string | null;
        userPermission: 'view' | 'commenter' | 'edit' | 'admin';
      }>,
      pages: [] as Array<{
        accessScope: 'public' | 'account';
        id: string;
        title: string;
        icon: string | null;
        updatedAt: string | null;
        publicPermission: 'view' | 'edit';
        createdBy?: string | null;
        ownerId?: string | null;
        userPermission: 'view' | 'commenter' | 'edit' | 'admin';
      }>,
    },
  },
  toolbarProps: vi.fn(),
  explorerItems: vi.fn(),
  pageCollaboratorIds: vi.fn(),
  folderCollaboratorIds: vi.fn(),
  idleMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});
vi.mock('../contexts/ShareContext', () => ({
  useShareContext: () => mocks.share,
}));
vi.mock('../contexts/ClipboardContext', () => ({
  useClipboard: () => ({ state: mocks.clipboardState, clear: vi.fn() }),
}));
vi.mock('../contexts/SelectionContext', () => ({
  useSelection: () => ({
    selectedItems: [],
    selectedCount: 0,
    clear: vi.fn(),
    toggle: vi.fn(),
    selectAll: vi.fn(),
    isSelected: () => false,
  }),
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ data: { user: { id: 'owner-1' } } }),
}));

vi.mock('../hooks/use-pages', () => ({
  usePageTree: () => ({
    data: mocks.pagesPending ? undefined : [],
    isPending: mocks.pagesPending,
    isFetching: mocks.pagesFetching,
    fetchStatus: mocks.pagesFetchStatus,
    error: mocks.pagesError,
    refetch: mocks.refetchPages,
  }),
  useCreatePage: mocks.idleMutation,
  useUpdatePage: mocks.idleMutation,
}));
vi.mock('../hooks/use-folders', () => ({
  useFolderTree: () => ({
    data: mocks.folderTree,
    isPending: mocks.foldersPending,
    isFetching: mocks.foldersFetching,
    fetchStatus: mocks.foldersFetchStatus,
    error: mocks.foldersError,
    refetch: mocks.refetchFolders,
  }),
  useCreateFolder: mocks.idleMutation,
  useUpdateFolder: mocks.idleMutation,
}));
vi.mock('../hooks/use-favorites', () => ({ useFavorites: () => ({ data: [] }) }));
vi.mock('../hooks/use-workspace', () => ({ useWorkspaceMemberships: () => ({ data: [] }) }));
vi.mock('../hooks/use-page-collaborators', () => ({
  usePageCollaborators: (ids: string[]) => {
    mocks.pageCollaboratorIds(ids);
    return { data: {} };
  },
  useFolderCollaborators: (ids: string[]) => {
    mocks.folderCollaboratorIds(ids);
    return { data: {} };
  },
}));
vi.mock('../hooks/use-bulk-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-bulk-actions')>()),
  useBulkMoveFolders: mocks.idleMutation,
  useBulkMovePages: mocks.idleMutation,
  useBulkRemoveEntities: mocks.idleMutation,
}));
vi.mock('../hooks/use-copy', () => ({
  useCopyFolder: mocks.idleMutation,
  useCopyPage: mocks.idleMutation,
}));
vi.mock('../components/workspace/ExplorerItem', () => ({
  ExplorerItem: ({ item }: { item: { title: string; type: string } }) => {
    mocks.explorerItems(item);
    return <div>{`${item.type}:${item.title}`}</div>;
  },
}));
vi.mock('../components/workspace/MoveDialog', () => ({ MoveDialog: () => null }));
vi.mock('../components/workspace/SelectionToolbar', () => ({
  SelectionToolbar: (props: unknown) => {
    mocks.toolbarProps(props);
    return null;
  },
}));

import FolderEntry from './FolderEntry';

describe('FolderEntry access refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.folderTree = [
      {
        id: FOLDER_ID,
        parentId: null,
        name: 'Stale tree name',
        icon: null,
        position: 'a0',
        createdBy: 'owner-2',
        ownerId: 'owner-2',
        createdAt: new Date(),
        updatedAt: new Date(),
        publicPermission: null,
        children: [],
      },
    ];
    mocks.pagesError = new Error('page tree failed');
    mocks.foldersError = new Error('folder tree failed');
    mocks.pagesPending = false;
    mocks.pagesFetching = false;
    mocks.pagesFetchStatus = 'idle';
    mocks.foldersPending = false;
    mocks.foldersFetching = false;
    mocks.foldersFetchStatus = 'idle';
    mocks.clipboardState = { action: null, items: [] };
    mocks.share.capabilities = {
      canEdit: true,
      canDelete: true,
      canCopy: true,
      canComment: true,
    };
    mocks.share.isAnonymous = false;
    mocks.share.publicEntity.folders = [];
    mocks.share.publicEntity.pages = [];
  });

  it('shows a loading indicator while the page tree is pending', () => {
    mocks.pagesError = null;
    mocks.foldersError = null;
    mocks.pagesFetching = true;
    mocks.pagesFetchStatus = 'fetching';
    mocks.pagesPending = true;

    render(
      <MemoryRouter initialEntries={[`/folder/fresh-${FOLDER_ID}`]}>
        <Routes>
          <Route path="/folder/:slugAndId" element={<FolderEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status', { name: 'Loading items' })).toBeInTheDocument();
  });

  it('uses fresh polled metadata for a router-aware canonical replace', async () => {
    render(
      <MemoryRouter initialEntries={[`/folder/stale-${FOLDER_ID}?mode=grid#section`]}>
        <Routes>
          <Route path="/folder/:slugAndId" element={<FolderEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mocks.navigate).toHaveBeenCalledWith(
      {
        pathname: buildFolderPath('Fresh polled name', FOLDER_ID),
        search: '?mode=grid',
        hash: '#section',
      },
      { replace: true },
    );
  });

  it('retries both page and folder trees after either fails', async () => {
    const user = userEvent.setup();
    mocks.refetchPages.mockResolvedValue(undefined);
    mocks.refetchFolders.mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={[`/folder/stale-${FOLDER_ID}`]}>
        <Routes>
          <Route path="/folder/:slugAndId" element={<FolderEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetchPages).toHaveBeenCalledOnce();
    expect(mocks.refetchFolders).toHaveBeenCalledOnce();
  });

  it('allows editors to paste copies but not cut items', () => {
    mocks.pagesError = null;
    mocks.foldersError = null;
    mocks.share.capabilities = {
      canEdit: true,
      canDelete: false,
      canCopy: true,
      canComment: true,
    };
    mocks.clipboardState = { action: 'copy', items: [{ id: 'page-1', type: 'page' }] };

    const rendered = render(
      <MemoryRouter initialEntries={[`/folder/fresh-${FOLDER_ID}`]}>
        <Routes>
          <Route path="/folder/:slugAndId" element={<FolderEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mocks.toolbarProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ canPaste: true, canMove: false }),
    );

    mocks.clipboardState = { action: 'cut', items: [{ id: 'page-1', type: 'page' }] };
    rendered.rerender(
      <MemoryRouter initialEntries={[`/folder/fresh-${FOLDER_ID}`]}>
        <Routes>
          <Route path="/folder/:slugAndId" element={<FolderEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mocks.toolbarProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ canPaste: false, canMove: false }),
    );
  });

  it('renders child folders from a public folder payload for anonymous visitors', () => {
    mocks.pagesError = null;
    mocks.foldersError = null;
    mocks.share.isAnonymous = true;
    mocks.share.publicEntity.folders = [
      {
        accessScope: 'public',
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Public child folder',
        icon: null,
        updatedAt: null,
        publicPermission: 'view',
        userPermission: 'view',
      },
    ];

    render(
      <MemoryRouter initialEntries={[`/folder/fresh-${FOLDER_ID}`]}>
        <Routes>
          <Route path="/folder/:slugAndId" element={<FolderEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('folder:Public child folder')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new page/i })).not.toBeInTheDocument();
    expect(mocks.folderCollaboratorIds).toHaveBeenLastCalledWith([
      '22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('retains signed-in child ownership and permissions when the folder is absent from the tree', () => {
    mocks.pagesError = null;
    mocks.foldersError = null;
    mocks.folderTree = [];
    mocks.share.publicEntity.pages = [
      {
        accessScope: 'account',
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Directly shared page',
        icon: null,
        updatedAt: null,
        publicPermission: 'view',
        createdBy: 'owner-2',
        ownerId: 'owner-2',
        userPermission: 'edit',
      },
    ];
    mocks.share.publicEntity.folders = [
      {
        accessScope: 'account',
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Admin child folder',
        icon: null,
        updatedAt: null,
        publicPermission: 'view',
        createdBy: 'owner-1',
        ownerId: 'owner-1',
        userPermission: 'admin',
      },
    ];

    render(
      <MemoryRouter initialEntries={[`/folder/fresh-${FOLDER_ID}`]}>
        <Routes>
          <Route path="/folder/:slugAndId" element={<FolderEntry />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mocks.explorerItems).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '33333333-3333-4333-8333-333333333333',
        createdBy: 'owner-2',
        ownerId: 'owner-2',
        userPermission: 'edit',
        canMove: false,
      }),
    );
    expect(mocks.explorerItems).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '44444444-4444-4444-8444-444444444444',
        createdBy: 'owner-1',
        ownerId: 'owner-1',
        userPermission: 'admin',
        canMove: true,
      }),
    );
  });
});
