import type { Folder, FolderTreeNode, Page, PageTreeNode, ShareEntityType } from '@metakip/shared';
import type { QueryClient } from '@tanstack/react-query';
import {
  addFolderToTree,
  addPageToTree,
  collectFolderSubtreeIds,
  findFolderInTree,
  removeFolderFromTree,
  removePageFromTree,
  updateFolderInTree,
  updatePageInTree,
} from './treeCache';

type RecentPageCacheItem = { id: string; title: string };
type FavoriteCacheItem = {
  entityType: ShareEntityType;
  entityId: string;
  title: string;
  icon?: string | null;
};

export function addCreatedPageToNavigationCache(queryClient: QueryClient, page: Page): void {
  const parent = page.parentId
    ? findFolderInTree(queryClient.getQueryData<FolderTreeNode[]>(['folderTree']), page.parentId)
    : undefined;
  queryClient.setQueryData<PageTreeNode[]>(['pageTree'], (pages) =>
    addPageToTree(pages, page, parent),
  );
}

export function addCreatedFolderToNavigationCache(queryClient: QueryClient, folder: Folder): void {
  queryClient.setQueryData<FolderTreeNode[]>(['folderTree'], (folders) =>
    addFolderToTree(folders, folder),
  );
}

export function updatePageNavigationCache(
  queryClient: QueryClient,
  pageId: string,
  updates: Partial<Page>,
): void {
  queryClient.setQueryData<PageTreeNode[]>(['pageTree'], (pages) =>
    updatePageInTree(pages, pageId, updates),
  );
  if (updates.title !== undefined) {
    queryClient.setQueriesData<RecentPageCacheItem[]>({ queryKey: ['pages', 'recent'] }, (pages) =>
      pages?.map((page) =>
        page.id === pageId && updates.title !== undefined
          ? { ...page, title: updates.title }
          : page,
      ),
    );
  }
  if (updates.title !== undefined || updates.icon !== undefined) {
    queryClient.setQueryData<FavoriteCacheItem[]>(['favorites'], (favorites) =>
      favorites?.map((favorite) =>
        favorite.entityType === 'page' && favorite.entityId === pageId
          ? {
              ...favorite,
              ...(updates.title !== undefined ? { title: updates.title } : {}),
              ...(updates.icon !== undefined ? { icon: updates.icon } : {}),
            }
          : favorite,
      ),
    );
  }
}

export function updateFolderNavigationCache(
  queryClient: QueryClient,
  folderId: string,
  updates: Partial<Folder>,
): void {
  queryClient.setQueryData<FolderTreeNode[]>(['folderTree'], (folders) =>
    updateFolderInTree(folders, folderId, updates),
  );
  if (updates.name !== undefined || updates.icon !== undefined) {
    queryClient.setQueryData<FavoriteCacheItem[]>(['favorites'], (favorites) =>
      favorites?.map((favorite) =>
        favorite.entityType === 'folder' && favorite.entityId === folderId
          ? {
              ...favorite,
              ...(updates.name !== undefined ? { title: updates.name } : {}),
              ...(updates.icon !== undefined ? { icon: updates.icon } : {}),
            }
          : favorite,
      ),
    );
  }
}

export function removePageFromNavigationCache(queryClient: QueryClient, pageId: string): void {
  queryClient.setQueryData<PageTreeNode[]>(['pageTree'], (pages) =>
    removePageFromTree(pages, pageId),
  );
  queryClient.setQueriesData<RecentPageCacheItem[]>({ queryKey: ['pages', 'recent'] }, (pages) =>
    pages?.filter((page) => page.id !== pageId),
  );
  queryClient.setQueryData<FavoriteCacheItem[]>(['favorites'], (favorites) =>
    favorites?.filter((favorite) => favorite.entityType !== 'page' || favorite.entityId !== pageId),
  );
}

export function removeFolderFromNavigationCache(queryClient: QueryClient, folderId: string): void {
  const removedFolderIds = collectFolderSubtreeIds(
    queryClient.getQueryData<FolderTreeNode[]>(['folderTree']),
    folderId,
  );
  const removedPageIds = new Set<string>();
  const collectRemovedPages = (pages: PageTreeNode[]) => {
    for (const page of pages) {
      if (page.parentId && removedFolderIds.has(page.parentId)) removedPageIds.add(page.id);
      collectRemovedPages(page.children);
    }
  };
  collectRemovedPages(queryClient.getQueryData<PageTreeNode[]>(['pageTree']) ?? []);

  queryClient.setQueryData<FolderTreeNode[]>(['folderTree'], (folders) =>
    removeFolderFromTree(folders, folderId),
  );
  queryClient.setQueryData<PageTreeNode[]>(['pageTree'], (pages) => {
    let next = pages;
    for (const pageId of removedPageIds) next = removePageFromTree(next, pageId);
    return next;
  });
  queryClient.setQueriesData<RecentPageCacheItem[]>({ queryKey: ['pages', 'recent'] }, (pages) =>
    pages?.filter((page) => !removedPageIds.has(page.id)),
  );
  queryClient.setQueryData<FavoriteCacheItem[]>(['favorites'], (favorites) =>
    favorites?.filter(
      (favorite) =>
        !removedPageIds.has(favorite.entityId) && !removedFolderIds.has(favorite.entityId),
    ),
  );
}
