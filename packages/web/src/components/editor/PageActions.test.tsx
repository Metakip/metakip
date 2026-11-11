import type {
  AccountPagePayload,
  FolderTreeNode,
  PageTreeNode,
  PublicPagePayload,
  SharedNavigationItem,
} from '@metakip/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipboardProvider } from '../../contexts/ClipboardContext';
import {
  createIdentityLifecycle,
  IdentityLifecycleProvider,
} from '../../contexts/IdentityLifecycleContext';
import type { Favorite } from '../../hooks/use-favorites';
import { createMockFolderTreeNode } from '../../test-utils/factories';
import { render } from '../../test-utils/render';
import type { ShareDialog } from './ShareDialog';

const mocks = vi.hoisted(() => ({
  favorites: [] as Favorite[],
  favoriteQuery: vi.fn(),
  toggleFavorite: vi.fn(),
  isAnonymous: false,
  pages: [] as Pick<PageTreeNode, 'id' | 'workspaceAccess'>[],
  shared: [] as SharedNavigationItem[],
  folders: [] as FolderTreeNode[],
  pagesReady: true,
  sharedReady: true,
  foldersReady: true,
  pageQuery: vi.fn(),
  sharedQuery: vi.fn(),
  moveToTrash: vi.fn(),
  removeFromView: vi.fn(),
}));

vi.mock('../../contexts/ShareContext', () => ({
  useShareContext: () => ({ isAnonymous: mocks.isAnonymous }),
}));
vi.mock('../../hooks/use-favorites', () => ({
  useFavorites: (options: unknown) => {
    mocks.favoriteQuery(options);
    return { data: mocks.favorites };
  },
  useToggleFavorite: () => ({ mutate: mocks.toggleFavorite }),
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ data: { user: { id: 'current-user' } } }),
}));
vi.mock('../../hooks/use-pages', () => ({
  usePageTree: (options: unknown) => {
    mocks.pageQuery(options);
    return { data: mocks.pages, isSuccess: mocks.pagesReady };
  },
}));
vi.mock('../../hooks/use-shared-with-me', () => ({
  useSharedWithMeTree: (limit: unknown, options: unknown) => {
    mocks.sharedQuery(limit, options);
    return { data: mocks.shared, isSuccess: mocks.sharedReady };
  },
}));
vi.mock('../../hooks/use-folders', () => ({
  useFolderTree: () => ({ data: mocks.folders, isSuccess: mocks.foldersReady }),
}));
vi.mock('../../hooks/use-workspace', () => ({
  useWorkspaceMemberships: () => ({ data: [], isSuccess: true }),
}));
vi.mock('../../utils/entity-actions', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../utils/entity-actions')>();
  return {
    ...original,
    useEntityDeletion: ({ onSuccess }: { onSuccess: () => void }) => ({
      moveToTrash: async (entity: unknown, options: unknown) => {
        await mocks.moveToTrash(entity, options);
        onSuccess();
      },
      removeFromView: async (entity: unknown) => {
        await mocks.removeFromView(entity);
        onSuccess();
      },
      isPending: false,
    }),
  };
});
vi.mock('./ShareDialog', () => ({
  ShareDialog: ({ entityId, title, onClose }: ComponentProps<typeof ShareDialog>) => (
    <div role="dialog" aria-label={`Share ${title}`} data-entity-id={entityId}>
      <button type="button" onClick={onClose}>
        Close sharing
      </button>
    </div>
  ),
}));

import { PageActions } from './PageActions';

const page: AccountPagePayload = {
  accessScope: 'account',
  id: 'page-1',
  title: 'Test page',
  icon: null,
  parentId: null,
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

const favorite: Favorite = {
  entityType: 'page',
  entityId: page.id,
  title: page.title,
  icon: page.icon,
  createdAt: null,
};

function renderActions(overrides: Partial<ComponentProps<typeof PageActions>> = {}) {
  return render(
    <ClipboardProvider>
      <PageActions
        page={page}
        permission="admin"
        onDeleted={vi.fn()}
        fullWidth={false}
        onToggleFullWidth={vi.fn()}
        canComment
        commentsOpen={false}
        commentsCount={0}
        onToggleComments={vi.fn()}
        {...overrides}
      />
    </ClipboardProvider>,
    { route: '/test-page' },
  );
}

describe('PageActions', () => {
  beforeEach(() => {
    mocks.favorites = [];
    mocks.isAnonymous = false;
    mocks.pages = [];
    mocks.shared = [];
    mocks.folders = [];
    mocks.pagesReady = true;
    mocks.sharedReady = true;
    mocks.foldersReady = true;
    mocks.moveToTrash.mockResolvedValue(undefined);
    mocks.removeFromView.mockResolvedValue(undefined);
  });

  it.each([
    false,
    true,
  ])('shares favorite state and handlers across controls (%s)', async (saved) => {
    mocks.favorites = saved ? [favorite] : [];
    renderActions();

    await userEvent.click(
      screen.getByRole('button', { name: saved ? 'Remove from favorites' : 'Add to favorites' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    const menuItem = await screen.findByRole('menuitem', {
      name: saved ? 'Unfavorite' : 'Favorite',
    });
    expect(menuItem).toHaveClass('md:hidden');
    await userEvent.click(menuItem);

    expect(mocks.toggleFavorite).toHaveBeenCalledTimes(2);
    for (const [variables] of mocks.toggleFavorite.mock.calls) {
      expect(variables).toEqual({
        entityType: 'page',
        entityId: page.id,
        title: page.title,
        icon: page.icon,
        ownerId: page.ownerId,
        isFavorite: saved,
      });
    }
  });

  it('recognizes legacy page IDs without treating a folder as the page favorite', () => {
    mocks.favorites = [{ ...favorite, entityType: 'folder' }];
    const view = renderActions();
    expect(screen.getByRole('button', { name: 'Add to favorites' })).toBeInTheDocument();
    view.unmount();

    mocks.favorites = [{ ...favorite, entityId: 'legacy-id', pageId: page.id }];
    renderActions();
    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toBeInTheDocument();
  });

  it('favorites a public-only page without account ownership metadata', async () => {
    const publicPage: PublicPagePayload = {
      accessScope: 'public',
      id: page.id,
      title: page.title,
      icon: page.icon,
      updatedAt: null,
      coverType: null,
      coverValue: null,
      properties: null,
      publicPermission: 'view',
      userPermission: 'view',
      capabilities: { canEdit: false, canComment: false, canDelete: false, canCopy: true },
    };
    renderActions({ page: publicPage, permission: 'view', canComment: false });
    await userEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));

    expect(mocks.toggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'page', entityId: publicPage.id, ownerId: null }),
    );
  });

  it.each(['desktop', 'menu'])('opens the shared dialog from %s controls', async (surface) => {
    renderActions();
    if (surface === 'menu') {
      await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Share' }));
    } else {
      await userEvent.click(screen.getByRole('button', { name: 'Share page' }));
    }

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Share Test page' })).toHaveAttribute(
      'data-entity-id',
      page.id,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close sharing' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    false,
    true,
  ])('shares the comments callback and open state (%s)', async (commentsOpen) => {
    const onToggleComments = vi.fn();
    renderActions({ commentsOpen, onToggleComments });
    const button = screen.getByRole('button', {
      name: commentsOpen ? 'Close comments' : 'Open comments',
    });
    expect(button).toHaveAttribute('aria-pressed', String(commentsOpen));
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await userEvent.click(
      await screen.findByRole('menuitem', { name: commentsOpen ? 'Close comments' : 'Comments' }),
    );
    expect(onToggleComments).toHaveBeenCalledTimes(2);
  });

  it('omits comments from both surfaces when the page cannot be commented on', async () => {
    renderActions({ canComment: false });
    expect(screen.queryByRole('button', { name: /comments/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: /comments/i })).not.toBeInTheDocument();
  });

  it('does not render account controls or load favorites for anonymous visitors', () => {
    mocks.isAnonymous = true;
    renderActions();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mocks.favoriteQuery).toHaveBeenLastCalledWith({ enabled: false });
  });

  it('does not mutate favorites after the identity retires', async () => {
    const lifecycle = createIdentityLifecycle();
    render(
      <IdentityLifecycleProvider lifecycle={lifecycle}>
        <ClipboardProvider>
          <PageActions
            page={page}
            permission="admin"
            onDeleted={vi.fn()}
            fullWidth={false}
            onToggleFullWidth={vi.fn()}
            canComment
            commentsOpen={false}
            commentsCount={0}
            onToggleComments={vi.fn()}
          />
        </ClipboardProvider>
      </IdentityLifecycleProvider>,
    );
    lifecycle.retire();
    await userEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Favorite' }));
    expect(mocks.toggleFavorite).not.toHaveBeenCalled();
  });

  it('uses one copy of each entity action in the toolbar menu', async () => {
    renderActions();
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    const labels = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);

    expect(labels).toEqual([
      'Favorite',
      'Comments',
      'Share',
      'Full width',
      'Export',
      'Copy',
      'Move to Trash',
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('enables navigation queries only when the menu opens', async () => {
    const user = userEvent.setup();
    renderActions();
    expect(mocks.pageQuery).toHaveBeenLastCalledWith({ enabled: false });
    expect(mocks.sharedQuery).toHaveBeenLastCalledWith(undefined, { enabled: false });

    await user.click(screen.getByRole('button', { name: 'Page actions' }));
    await screen.findByRole('menu');

    await waitFor(() => {
      expect(mocks.pageQuery).toHaveBeenLastCalledWith({ enabled: true });
      expect(mocks.sharedQuery).toHaveBeenLastCalledWith(undefined, { enabled: true });
    });

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(mocks.pageQuery).toHaveBeenLastCalledWith({ enabled: false });
    expect(mocks.sharedQuery).toHaveBeenLastCalledWith(undefined, { enabled: false });
  });

  it.each([false, true])('offers one width action (full width: %s)', async (fullWidth) => {
    const onToggleFullWidth = vi.fn();
    renderActions({ fullWidth, onToggleFullWidth });
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    const item = await screen.findByRole('menuitem', {
      name: fullWidth ? 'Default width' : 'Full width',
    });
    await userEvent.click(item);
    expect(onToggleFullWidth).toHaveBeenCalledOnce();
  });

  it('withholds personal removal while workspace navigation is unresolved', async () => {
    mocks.pagesReady = false;
    mocks.shared = [
      {
        entityType: 'page',
        id: page.id,
        title: page.title,
        icon: null,
        parentId: null,
        ownerId: page.ownerId,
        createdBy: page.createdBy,
        updatedAt: null,
        userPermission: 'view',
        source: 'direct',
      },
    ];
    renderActions({ permission: 'view' });
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'Remove for me' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move to Trash' })).not.toBeInTheDocument();
  });

  it('offers Move only after the source-folder administration is resolved', async () => {
    mocks.foldersReady = false;
    mocks.folders = [createMockFolderTreeNode({ id: 'folder-1', userPermission: 'admin' })];
    renderActions({ page: { ...page, parentId: 'folder-1' } });
    const trigger = screen.getByRole('button', { name: 'Page actions' });
    await userEvent.click(trigger);
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'Move' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    mocks.foldersReady = true;
    await userEvent.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Move' })).toBeInTheDocument();
  });

  it.each([
    null,
    'folder-1',
  ])('calls the exit handler only after confirmed successful removal (parent: %s)', async (parentId) => {
    const onDeleted = vi.fn();
    renderActions({ page: { ...page, parentId }, onDeleted });
    await userEvent.click(screen.getByRole('button', { name: 'Page actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));

    expect(onDeleted).not.toHaveBeenCalled();
    expect(mocks.moveToTrash).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(mocks.moveToTrash).toHaveBeenCalledOnce();
  });
});
