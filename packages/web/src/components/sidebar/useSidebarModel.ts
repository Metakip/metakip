import type { FolderTreeNode, PageTreeNode, SharedNavigationItem } from '@metakip/shared';
import { useMemo } from 'react';
import type { Favorite } from '../../hooks/use-favorites';
import type { RecentPage } from '../../hooks/use-pages';
import type { WorkspaceMembership } from '../../hooks/use-workspace';
import { resolveRemovalShareSource } from '../../utils/entity-actions';
import { buildPagesByFolder, collectAllFolderIds, getRootPages } from '../../utils/page-tree';
import type { SidebarAliasRow } from './SidebarSections';
import { deriveSidebarCapabilities, type SidebarPlacement } from './sidebarCapabilities';
import type { SidebarEntityAuthorization } from './sidebarRuntime';

function collectSharedFolderIds(items: readonly SharedNavigationItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.entityType !== 'folder') continue;
    ids.push(item.id, ...collectSharedFolderIds(item.children));
  }
  return ids;
}

export function useSidebarModel(options: {
  currentUserId: string | undefined;
  pages: PageTreeNode[];
  folders: FolderTreeNode[];
  favorites: Favorite[];
  recentPages: RecentPage[];
  sharedNavigation: SharedNavigationItem[];
  workspaceMemberships: WorkspaceMembership[];
}) {
  const {
    currentUserId,
    pages,
    folders,
    favorites,
    recentPages,
    sharedNavigation,
    workspaceMemberships,
  } = options;
  return useMemo(() => {
    const pageById = new Map(pages.map((page) => [page.id, page]));
    const folderById = new Map<string, FolderTreeNode>();
    const indexFolders = (nodes: readonly FolderTreeNode[]) => {
      for (const folder of nodes) {
        folderById.set(folder.id, folder);
        indexFolders(folder.children ?? []);
      }
    };
    indexFolders(folders);
    const sharedByKey = new Map<string, SharedNavigationItem>();
    const indexShared = (items: readonly SharedNavigationItem[]) => {
      for (const item of items) {
        sharedByKey.set(`${item.entityType}:${item.id}`, item);
        if (item.entityType === 'folder') indexShared(item.children);
      }
    };
    indexShared(sharedNavigation);

    type CanonicalSidebarEntity = SidebarEntityAuthorization & {
      type: 'page' | 'folder';
      id: string;
    };
    const entitiesByKey = new Map<string, CanonicalSidebarEntity>();
    for (const page of pages) {
      entitiesByKey.set(`page:${page.id}`, { ...page, type: 'page' });
    }
    for (const folder of folderById.values()) {
      entitiesByKey.set(`folder:${folder.id}`, { ...folder, type: 'folder' });
    }
    // Page/folder tree responses are the canonical effective-access snapshots.
    // Shared navigation is only a fallback for an entity omitted from those trees.
    for (const item of sharedByKey.values()) {
      const key = `${item.entityType}:${item.id}`;
      if (entitiesByKey.has(key)) continue;
      entitiesByKey.set(key, {
        type: item.entityType,
        id: item.id,
        ownerId: item.ownerId,
        createdBy: item.createdBy,
        userPermission: item.userPermission,
        parentId: item.parentId,
      });
    }
    const getSidebarCapabilities = (
      entityType: 'page' | 'folder',
      entityId: string,
      placement: SidebarPlacement,
      sourceIsAdmin: boolean,
    ) => {
      const entity = entitiesByKey.get(`${entityType}:${entityId}`);
      return deriveSidebarCapabilities({
        entityType,
        ownerId: entity?.ownerId,
        createdBy: entity?.createdBy,
        userPermission: entity?.userPermission,
        currentUserId,
        placement,
        sourceIsAdmin,
      });
    };
    const canRenameSidebarEntity = (entityType: 'page' | 'folder', entityId: string) =>
      getSidebarCapabilities(entityType, entityId, 'alias', false).canRename;
    const getSidebarAuthorization = (entityType: 'page' | 'folder', entityId: string) =>
      entitiesByKey.get(`${entityType}:${entityId}`);

    const filterOwned = (nodes: readonly FolderTreeNode[]): FolderTreeNode[] =>
      nodes
        .filter((folder) => folder.ownerId === currentUserId)
        .map((folder) => ({ ...folder, children: filterOwned(folder.children ?? []) }));
    const ownedFolders = filterOwned(folders);
    const ownedPages = pages.filter((page) => page.ownerId === currentUserId);
    const ownedFolderIds = collectAllFolderIds(ownedFolders);
    const visibleOwnedFolderIds = new Set(ownedFolderIds);
    const pagesByFolder = buildPagesByFolder(ownedPages, visibleOwnedFolderIds);
    const rootPages = getRootPages(ownedPages, visibleOwnedFolderIds);
    const foldersByParent = new Map<string | null, FolderTreeNode[]>();
    for (const folder of folderById.values()) {
      if (folder.ownerId !== currentUserId) continue;
      const parentId = folder.parentId ?? null;
      const siblings = foldersByParent.get(parentId) ?? [];
      siblings.push(folder);
      foldersByParent.set(parentId, siblings);
    }
    const allPagesByFolder = buildPagesByFolder(pages, new Set(folderById.keys()));
    const workspaceGroups = workspaceMemberships.map((membership) => ({
      ...membership,
      folders: folders.filter(
        (folder) => folder.ownerId === membership.ownerId && folder.workspaceAccess === true,
      ),
      pages: pages.filter(
        (page) =>
          page.ownerId === membership.ownerId &&
          page.workspaceAccess === true &&
          page.parentId === null,
      ),
    }));
    const sidebarFolderIds = [
      ...new Set([
        ...ownedFolderIds,
        ...collectSharedFolderIds(sharedNavigation),
        ...workspaceGroups.flatMap((group) => collectAllFolderIds(group.folders)),
      ]),
    ];
    const favoriteRows: SidebarAliasRow[] = favorites.map((favorite) => {
      const entity = entitiesByKey.get(`${favorite.entityType}:${favorite.entityId}`);
      const sharedItem = sharedByKey.get(`${favorite.entityType}:${favorite.entityId}`);
      const shareSource = resolveRemovalShareSource(
        sharedItem?.source,
        favorite.entityType === 'page'
          ? pageById.get(favorite.entityId)?.workspaceAccess === true
          : folderById.get(favorite.entityId)?.workspaceAccess === true,
      );
      return {
        key: `${favorite.entityType}-${favorite.entityId}`,
        row: {
          entityType: favorite.entityType,
          id: favorite.entityId,
          title: favorite.title,
          icon: favorite.icon,
          ownerId: entity?.ownerId ?? favorite.ownerId ?? null,
          createdBy: entity?.createdBy ?? null,
          userPermission: entity?.userPermission ?? null,
          parentId: entity?.parentId ?? sharedItem?.parentId,
          ...(shareSource ? { shareSource } : {}),
        },
      };
    });
    const recentRows: SidebarAliasRow[] = recentPages.flatMap((recent) => {
      const page = pageById.get(recent.id);
      if (!page) return [];
      const entity = entitiesByKey.get(`page:${recent.id}`);
      const sharedItem = sharedByKey.get(`page:${recent.id}`);
      const shareSource = resolveRemovalShareSource(
        sharedItem?.source,
        page.workspaceAccess === true,
      );
      return [
        {
          key: recent.id,
          row: {
            entityType: 'page' as const,
            id: recent.id,
            title: recent.title,
            icon: recent.icon,
            ownerId: entity?.ownerId ?? recent.ownerId,
            createdBy: entity?.createdBy ?? recent.createdBy,
            userPermission: entity?.userPermission ?? null,
            parentId: entity?.parentId ?? sharedItem?.parentId,
            ...(shareSource ? { shareSource } : {}),
          },
        },
      ];
    });
    const directSharedNavigation = sharedNavigation.filter((item) => {
      const workspaceAccess =
        item.entityType === 'folder'
          ? folderById.get(item.id)?.workspaceAccess
          : pageById.get(item.id)?.workspaceAccess;
      return workspaceAccess !== true;
    });
    return {
      allPagesByFolder,
      canRenameSidebarEntity,
      directSharedNavigation,
      favoriteRows,
      foldersByParent,
      getSidebarAuthorization,
      getSidebarCapabilities,
      ownedFolders,
      pageById,
      pagesByFolder,
      recentRows,
      rootPages,
      sidebarFolderIds,
      workspaceGroups,
    };
  }, [
    currentUserId,
    favorites,
    folders,
    pages,
    recentPages,
    sharedNavigation,
    workspaceMemberships,
  ]);
}
