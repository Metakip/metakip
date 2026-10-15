import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/AppShellToolbar', () => ({
  AppShellToolbar: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const mocks = vi.hoisted(() => ({
  refetchPages: vi.fn(),
  refetchFolders: vi.fn(),
  restorePage: vi.fn(),
  restoreFolder: vi.fn(),
  permanentDeletePage: vi.fn(),
  permanentDeleteFolder: vi.fn(),
  emptyAll: vi.fn(() => Promise.resolve()),
}));

vi.mock('../hooks/use-pages', () => ({
  useTrashPages: () => ({
    data: [
      {
        id: 'page-1',
        title: 'Deleted page',
        icon: null,
        deletedAt: '2026-07-16T00:00:00.000Z',
      },
    ],
    isLoading: false,
    isError: false,
    refetch: mocks.refetchPages,
  }),
  useRestorePage: () => ({ mutate: mocks.restorePage, isPending: false }),
  usePermanentDeletePage: () => ({ mutate: mocks.permanentDeletePage, isPending: false }),
}));

vi.mock('../hooks/use-folders', () => ({
  useTrashFolders: () => ({
    data: [
      {
        id: 'folder-1',
        name: 'Deleted folder',
        icon: null,
        deletedAt: '2026-07-17T00:00:00.000Z',
      },
    ],
    isLoading: false,
    isError: false,
    refetch: mocks.refetchFolders,
  }),
  useRestoreFolder: () => ({ mutate: mocks.restoreFolder, isPending: false }),
  usePermanentDeleteFolder: () => ({ mutate: mocks.permanentDeleteFolder, isPending: false }),
}));

vi.mock('../hooks/use-trash', () => ({
  useEmptyAllTrash: () => ({ mutateAsync: mocks.emptyAll, isPending: false }),
}));

import Trash from './Trash';

function renderTrash() {
  return render(
    <MemoryRouter>
      <Trash />
    </MemoryRouter>,
  );
}

describe('Trash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emptyAll.mockResolvedValue(undefined);
  });

  it('lists deleted pages and folders and restores the selected kind', async () => {
    const user = userEvent.setup();
    renderTrash();

    expect(screen.getByText('Deleted page')).toBeInTheDocument();
    const folderTitle = screen.getByText('Deleted folder');
    const folderRow = folderTitle.closest('div.flex.items-center.justify-between');
    expect(folderRow).not.toBeNull();

    await user.click(within(folderRow as HTMLElement).getByRole('button', { name: 'Restore' }));

    expect(mocks.restoreFolder).toHaveBeenCalledWith('folder-1');
    expect(mocks.restorePage).not.toHaveBeenCalled();
  });

  it('warns about folder contents before permanent deletion', async () => {
    const user = userEvent.setup();
    renderTrash();

    await user.click(screen.getByTitle('Delete folder permanently'));

    expect(screen.getByText(/All pages and folders inside it will also be deleted/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(mocks.permanentDeleteFolder).toHaveBeenCalledWith(
      'folder-1',
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mocks.permanentDeletePage).not.toHaveBeenCalled();
  });

  it('empties page and folder trash through one atomic request', async () => {
    const user = userEvent.setup();
    renderTrash();

    await user.click(screen.getByRole('button', { name: 'Empty all' }));
    expect(screen.getByText(/all 2 top-level items/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Empty trash' }));

    await waitFor(() => {
      expect(mocks.emptyAll).toHaveBeenCalledOnce();
    });
  });
});
