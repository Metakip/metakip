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
type StarredEntityCacheItem = {
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
    queryClient.setQueryData<StarredEntityCacheItem[]>(['stars'], (stars) =>
      stars?.map((star) =>
        star.entityType === 'page' && star.entityId === pageId
          ? {
              ...star,
              ...(updates.title !== undefined ? { title: updates.title } : {}),
              ...(updates.icon !== undefined ? { icon: updates.icon } : {}),
            }
          : star,
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
    queryClient.setQueryData<StarredEntityCacheItem[]>(['stars'], (stars) =>
      stars?.map((star) =>
        star.entityType === 'folder' && star.entityId === folderId
          ? {
              ...star,
              ...(updates.name !== undefined ? { title: updates.name } : {}),
              ...(updates.icon !== undefined ? { icon: updates.icon } : {}),
            }
          : star,
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
  queryClient.setQueryData<StarredEntityCacheItem[]>(['stars'], (stars) =>
    stars?.filter((star) => star.entityType !== 'page' || star.entityId !== pageId),
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
  queryClient.setQueryData<StarredEntityCacheItem[]>(['stars'], (stars) =>
    stars?.filter(
      (star) => !removedPageIds.has(star.entityId) && !removedFolderIds.has(star.entityId),
    ),
  );
}
