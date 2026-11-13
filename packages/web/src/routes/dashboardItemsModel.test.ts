import { describe, expect, it } from 'vitest';
import type { StarredEntity } from '../hooks/use-stars';
import { createMockFolderTreeNode, createMockPageTreeNode } from '../test-utils/factories';
import { buildStarredDashboardItems, type DashboardItem } from './dashboardItemsModel';

const WORKSPACE_OWNER_ID = 'workspace-owner';
const CURRENT_USER_ID = 'workspace-admin';

function starredEntity(
  entityType: 'page' | 'folder',
  entityId: string,
  shareSource?: StarredEntity['shareSource'],
): StarredEntity {
  return {
    entityType,
    entityId,
    title: 'Starred item',
    icon: null,
    ownerId: WORKSPACE_OWNER_ID,
    ...(shareSource ? { shareSource } : {}),
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildStarredDashboardItems', () => {
  it('preserves star order and reuses existing items by entity type and ID', () => {
    const page: DashboardItem = {
      id: 'same-id',
      type: 'page',
      title: 'Existing page',
      updatedAt: '2026-02-01T00:00:00.000Z',
      ownerId: CURRENT_USER_ID,
    };
    const folder: DashboardItem = { ...page, type: 'folder', title: 'Existing folder' };

    const items = buildStarredDashboardItems({
      activeFilter: 'all',
      allItems: [page, folder],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      stars: [starredEntity('folder', folder.id), starredEntity('page', page.id)],
      folders: [],
      pages: [],
      workspaceAdminOwnerIds: new Set(),
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toBe(folder);
    expect(items[1]).toBe(page);
  });

  it('keeps starred-only pages and folders without tree metadata', () => {
    const pageStar = starredEntity('page', 'same-id', 'public');
    const folderStar = starredEntity('folder', 'same-id', 'direct');
    const owner = {
      userId: WORKSPACE_OWNER_ID,
      name: 'Owner',
      avatarUrl: null,
      permission: 'admin' as const,
      isOwner: true,
    };
    const pageCollaborators = [owner];
    const folderCollaborators = [
      { ...owner, userId: CURRENT_USER_ID, permission: 'view' as const, isOwner: false },
    ];

    const items = buildStarredDashboardItems({
      activeFilter: 'shared-with-me',
      allItems: [],
      collaboratorsByFolderId: { [folderStar.entityId]: folderCollaborators },
      collaboratorsByPageId: { [pageStar.entityId]: pageCollaborators },
      currentUserId: CURRENT_USER_ID,
      stars: [pageStar, folderStar],
      folders: undefined,
      pages: undefined,
      workspaceAdminOwnerIds: new Set(),
    });

    expect(items).toEqual(
      [pageStar, folderStar].map((star, index) => ({
        id: star.entityId,
        type: star.entityType,
        title: star.title,
        icon: star.icon,
        ownerId: star.ownerId,
        updatedAt: star.createdAt,
        activityAt: star.createdAt,
        createdBy: undefined,
        userPermission: undefined,
        shareSource: star.shareSource,
        collaborators: index === 0 ? pageCollaborators : folderCollaborators,
        canMove: false,
      })),
    );
  });

  it('enriches pages and nested folders from their matching tree metadata', () => {
    const page = createMockPageTreeNode({
      id: 'same-id',
      title: 'Current page title',
      icon: 'page-icon',
      coverType: 'solid',
      coverValue: '#123456',
      ownerId: CURRENT_USER_ID,
    });
    const folder = createMockFolderTreeNode({
      id: 'same-id',
      name: 'Current folder name',
      icon: 'folder-icon',
      ownerId: CURRENT_USER_ID,
    });

    const items = buildStarredDashboardItems({
      activeFilter: 'owned-by-me',
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      stars: [starredEntity('page', page.id), starredEntity('folder', folder.id)],
      folders: [createMockFolderTreeNode({ children: [folder] })],
      pages: [page],
      workspaceAdminOwnerIds: new Set(),
    });

    expect(items).toEqual([
      expect.objectContaining({
        type: 'page',
        title: page.title,
        icon: page.icon,
        coverType: page.coverType,
        coverValue: page.coverValue,
        ownerId: CURRENT_USER_ID,
        updatedAt: page.updatedAt,
        canMove: true,
      }),
      expect.objectContaining({
        type: 'folder',
        title: folder.name,
        icon: folder.icon,
        ownerId: CURRENT_USER_ID,
        updatedAt: folder.updatedAt,
        canMove: true,
      }),
    ]);
    expect(items[1]).not.toHaveProperty('coverType');
    expect(items[1]).not.toHaveProperty('coverValue');
  });

  it('uses the canonical workspace source for a nested starred item', () => {
    const page = createMockPageTreeNode({
      id: 'nested-page',
      parentId: 'nested-folder',
      title: 'Nested starred page',
      ownerId: WORKSPACE_OWNER_ID,
      userPermission: 'admin',
      workspaceAccess: true,
    });

    const items = buildStarredDashboardItems({
      activeFilter: 'shared-with-me',
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      stars: [starredEntity('page', page.id, 'workspace')],
      folders: [],
      pages: [page],
      workspaceAdminOwnerIds: new Set([WORKSPACE_OWNER_ID]),
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: page.id,
        type: 'page',
        title: page.title,
        canMove: true,
        shareSource: 'workspace',
      }),
    ]);
  });

  it('uses the canonical workspace source for a starred workspace folder', () => {
    const folder = createMockFolderTreeNode({
      id: 'workspace-folder',
      ownerId: WORKSPACE_OWNER_ID,
      workspaceAccess: true,
    });

    const [item] = buildStarredDashboardItems({
      activeFilter: 'shared-with-me',
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      stars: [starredEntity('folder', folder.id, 'workspace')],
      folders: [folder],
      pages: [],
      workspaceAdminOwnerIds: new Set(),
    });

    expect(item?.shareSource).toBe('workspace');
  });

  it('filters starred-only folders by the active dashboard filter', () => {
    const folder = createMockFolderTreeNode({
      id: 'owned-folder',
      ownerId: CURRENT_USER_ID,
      name: 'Owned starred folder',
    });
    const options = {
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      stars: [starredEntity('folder', folder.id)],
      folders: [folder],
      pages: [],
      workspaceAdminOwnerIds: new Set<string>(),
    };

    expect(buildStarredDashboardItems({ ...options, activeFilter: 'owned-by-me' })).toHaveLength(1);
    expect(buildStarredDashboardItems({ ...options, activeFilter: 'shared-with-me' })).toHaveLength(
      0,
    );
  });

  it('preserves a direct share for a starred page nested under a shared folder', () => {
    const sharedFolder = createMockFolderTreeNode({
      id: 'shared-folder',
      ownerId: WORKSPACE_OWNER_ID,
    });
    const page = createMockPageTreeNode({
      id: 'directly-shared-page',
      parentId: sharedFolder.id,
      ownerId: WORKSPACE_OWNER_ID,
    });

    const [item] = buildStarredDashboardItems({
      activeFilter: 'shared-with-me',
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      stars: [starredEntity('page', page.id, 'direct')],
      folders: [sharedFolder],
      pages: [page],
      workspaceAdminOwnerIds: new Set(),
    });

    expect(item?.shareSource).toBe('direct');
  });

  it('preserves a public visit source for a starred-only page', () => {
    const page = createMockPageTreeNode({
      id: 'public-page',
      ownerId: WORKSPACE_OWNER_ID,
    });

    const [item] = buildStarredDashboardItems({
      activeFilter: 'shared-with-me',
      allItems: [],
      collaboratorsByFolderId: undefined,
      collaboratorsByPageId: undefined,
      currentUserId: CURRENT_USER_ID,
      stars: [starredEntity('page', page.id, 'public')],
      folders: [],
      pages: [page],
      workspaceAdminOwnerIds: new Set(),
    });

    expect(item?.shareSource).toBe('public');
  });
});
