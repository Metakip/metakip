import type { FolderTreeNode, PageTreeNode } from '@metakip/shared';

export function collectAllFolderIds(folders: FolderTreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (nodes: FolderTreeNode[]) => {
    for (const folder of nodes) {
      ids.push(folder.id);
      if (folder.children?.length) {
        walk(folder.children);
      }
    }
  };
  walk(folders);
  return ids;
}

export function getRootPages(
  pages: PageTreeNode[],
  visibleFolderIds?: Set<string>,
): PageTreeNode[] {
  return pages.filter(
    (page) => page.parentId === null || (visibleFolderIds && !visibleFolderIds.has(page.parentId)),
  );
}

export function getPagesInFolder(
  pages: PageTreeNode[],
  folderId: string | null,
  visibleFolderIds?: Set<string>,
): PageTreeNode[] {
  return pages.filter((page) => {
    // Only show pages in this folder if the folder is actually visible
    // If parentId matches but folder isn't visible, this is an orphan — don't group it here
    if (page.parentId === null) return false;
    if (page.parentId !== folderId) return false;
    return visibleFolderIds?.has(folderId) ?? true;
  });
}

export function buildPagesByFolder(
  pages: PageTreeNode[],
  visibleFolderIds?: Set<string>,
): Map<string | null, PageTreeNode[]> {
  const map = new Map<string | null, PageTreeNode[]>();
  for (const page of pages) {
    const key = page.parentId ?? null;
    // Skip pages whose parent folder isn't visible — they'll appear at root level instead
    if (key && visibleFolderIds && !visibleFolderIds.has(key)) {
      continue;
    }
    const list = map.get(key) ?? [];
    list.push(page);
    map.set(key, list);
  }
  return map;
}
