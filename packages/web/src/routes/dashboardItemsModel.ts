import type {
  CollaboratorDisplay,
  FolderTreeNode,
  PageTreeNode,
  SharedWithMeItem,
} from '@metakip/shared';
import type { ExplorerItemData } from '../components/workspace/ExplorerItem';
import type { Favorite } from '../hooks/use-favorites';

export type DashboardFilter = 'all' | 'owned-by-me' | 'shared-with-me';

export type DashboardItem = ExplorerItemData & {
  activityAt?: string | Date;
};

const dateMs = (value: string | Date | null | undefined): number => {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const sortDashboardItemsByActivity = (a: DashboardItem, b: DashboardItem): number => {
  const aTime = Math.max(dateMs(a.activityAt), dateMs(a.updatedAt));
  const bTime = Math.max(dateMs(b.activityAt), dateMs(b.updatedAt));
  return bTime - aTime;
};

export const sharedItemToDashboardItem = (item: SharedWithMeItem): DashboardItem => ({
  id: item.entityId,
  type: item.entityType,
  title: item.title,
  icon: item.icon,
  ownerId: item.ownerId,
  userPermission: item.permission,
  shareSource: item.source,
  canMove: false,
  updatedAt: item.entityUpdatedAt ?? item.updatedAt ?? item.createdAt ?? item.sortAt ?? new Date(),
  activityAt: item.sortAt ?? item.updatedAt ?? item.createdAt ?? item.entityUpdatedAt ?? new Date(),
});

export function buildFavoriteDashboardItems({
  activeFilter,
  allItems,
  collaboratorsByFolderId,
  collaboratorsByPageId,
  currentUserId,
  favorites,
  folders,
  pages,
  workspaceAdminOwnerIds,
}: {
  activeFilter: DashboardFilter;
  allItems: DashboardItem[];
  collaboratorsByFolderId: Record<string, CollaboratorDisplay[]> | undefined;
  collaboratorsByPageId: Record<string, CollaboratorDisplay[]> | undefined;
  currentUserId: string | undefined;
  favorites: Favorite[] | undefined;
  folders: FolderTreeNode[] | undefined;
  pages: PageTreeNode[] | undefined;
  workspaceAdminOwnerIds: ReadonlySet<string>;
}): DashboardItem[] {
  const allItemsByKey = new Map(allItems.map((item) => [`${item.type}:${item.id}`, item]));
  const pagesById = new Map((pages ?? []).map((page) => [page.id, page]));
  const foldersById = new Map<string, FolderTreeNode>();
  const indexFolders = (nodes: FolderTreeNode[]) => {
    for (const folder of nodes) {
      foldersById.set(folder.id, folder);
      indexFolders(folder.children);
    }
  };
  indexFolders(folders ?? []);

  return (favorites ?? [])
    .flatMap((favorite): DashboardItem[] => {
      if (favorite.entityType !== 'page' && favorite.entityType !== 'folder') return [];

      const key = `${favorite.entityType}:${favorite.entityId}`;
      const dashboardItem = allItemsByKey.get(key);
      if (dashboardItem) return [dashboardItem];

      if (favorite.entityType === 'page') {
        const page = pagesById.get(favorite.entityId);
        return [
          {
            id: favorite.entityId,
            type: 'page',
            title: page?.title ?? favorite.title,
            icon: page?.icon ?? favorite.icon,
            updatedAt: page?.updatedAt ?? favorite.createdAt ?? new Date(),
            activityAt: page?.updatedAt ?? favorite.createdAt ?? new Date(),
            ...(page?.coverType !== undefined ? { coverType: page.coverType } : {}),
            ...(page?.coverValue !== undefined ? { coverValue: page.coverValue } : {}),
            ownerId: page?.ownerId ?? favorite.ownerId ?? null,
            createdBy: page?.createdBy,
            userPermission: page?.userPermission,
            ...(favorite.shareSource ? { shareSource: favorite.shareSource } : {}),
            ...(collaboratorsByPageId?.[favorite.entityId]
              ? { collaborators: collaboratorsByPageId[favorite.entityId] }
              : {}),
            canMove:
              page?.ownerId === currentUserId ||
              (page?.workspaceAccess === true &&
                page.userPermission === 'admin' &&
                !!page.ownerId &&
                workspaceAdminOwnerIds.has(page.ownerId)),
          },
        ];
      }

      const folder = foldersById.get(favorite.entityId);
      return [
        {
          id: favorite.entityId,
          type: 'folder',
          title: folder?.name ?? favorite.title,
          icon: folder?.icon ?? favorite.icon,
          updatedAt: folder?.updatedAt ?? favorite.createdAt ?? new Date(),
          activityAt: folder?.updatedAt ?? favorite.createdAt ?? new Date(),
          ownerId: folder?.ownerId ?? favorite.ownerId ?? null,
          createdBy: folder?.createdBy,
          userPermission: folder?.userPermission,
          ...(favorite.shareSource ? { shareSource: favorite.shareSource } : {}),
          ...(collaboratorsByFolderId?.[favorite.entityId]
            ? { collaborators: collaboratorsByFolderId[favorite.entityId] }
            : {}),
          canMove:
            folder?.ownerId === currentUserId ||
            (folder?.workspaceAccess === true &&
              folder.userPermission === 'admin' &&
              !!folder.ownerId &&
              workspaceAdminOwnerIds.has(folder.ownerId)),
        },
      ];
    })
    .filter((item) => {
      if (activeFilter === 'owned-by-me') return item.ownerId === currentUserId;
      if (activeFilter === 'shared-with-me') return item.ownerId !== currentUserId;
      return true;
    });
}
