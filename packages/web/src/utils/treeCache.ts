import type { Folder, FolderTreeNode, Page, PageTreeNode } from '@metakip/shared';

type TreeNodeContext = Pick<FolderTreeNode, 'ownerId' | 'userPermission' | 'workspaceAccess'>;

export function findFolderInTree(
  folders: FolderTreeNode[] | undefined,
  folderId: string,
): FolderTreeNode | undefined {
  for (const folder of folders ?? []) {
    if (folder.id === folderId) return folder;
    const child = findFolderInTree(folder.children, folderId);
    if (child) return child;
  }
  return undefined;
}

export function toPageTreeNode(page: Page, context?: TreeNodeContext): PageTreeNode {
  return {
    ...page,
    ownerId: page.ownerId ?? context?.ownerId ?? page.createdBy,
    ...(context?.userPermission !== undefined ? { userPermission: context.userPermission } : {}),
    ...(context?.workspaceAccess !== undefined ? { workspaceAccess: context.workspaceAccess } : {}),
    children: [],
  };
}

export function addPageToTree(
  pages: PageTreeNode[] | undefined,
  page: Page,
  context?: TreeNodeContext,
): PageTreeNode[] | undefined {
  if (!pages) return pages;
  const withoutDuplicate = removePageFromTree(pages, page.id) ?? [];
  const node = toPageTreeNode(page, context);
  return page.parentId === null ? [node, ...withoutDuplicate] : [...withoutDuplicate, node];
}

export function updatePageInTree(
  nodes: PageTreeNode[] | undefined,
  pageId: string,
  updates: Partial<Page>,
): PageTreeNode[] | undefined {
  if (!nodes) return nodes;

  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === pageId) {
      changed = true;
      return { ...node, ...updates, children: node.children };
    }

    const children = updatePageInTree(node.children, pageId, updates) ?? node.children;
    if (children !== node.children) {
      changed = true;
      return { ...node, children };
    }
    return node;
  });

  return changed ? next : nodes;
}

export function removePageFromTree(
  nodes: PageTreeNode[] | undefined,
  pageId: string,
): PageTreeNode[] | undefined {
  if (!nodes) return nodes;

  let changed = false;
  const next: PageTreeNode[] = [];
  for (const node of nodes) {
    if (node.id === pageId) {
      changed = true;
      continue;
    }
    const children = removePageFromTree(node.children, pageId) ?? node.children;
    if (children !== node.children) changed = true;
    next.push(children === node.children ? node : { ...node, children });
  }
  return changed ? next : nodes;
}

export function toFolderTreeNode(folder: Folder, context?: TreeNodeContext): FolderTreeNode {
  return {
    ...folder,
    ownerId: folder.ownerId ?? context?.ownerId ?? folder.createdBy,
    ...(context?.userPermission !== undefined ? { userPermission: context.userPermission } : {}),
    ...(context?.workspaceAccess !== undefined ? { workspaceAccess: context.workspaceAccess } : {}),
    children: [],
  };
}

export function addFolderToTree(
  folders: FolderTreeNode[] | undefined,
  folder: Folder,
): FolderTreeNode[] | undefined {
  if (!folders) return folders;
  const withoutDuplicate = removeFolderFromTree(folders, folder.id) ?? [];
  const parent = folder.parentId ? findFolderInTree(withoutDuplicate, folder.parentId) : undefined;
  const node = toFolderTreeNode(folder, parent);
  if (folder.parentId === null) return [node, ...withoutDuplicate];

  let inserted = false;
  const insertBelowParent = (nodes: FolderTreeNode[]): FolderTreeNode[] => {
    let changed = false;
    const next = nodes.map((candidate) => {
      if (candidate.id === folder.parentId) {
        inserted = true;
        changed = true;
        return { ...candidate, children: [...candidate.children, node] };
      }
      const children = insertBelowParent(candidate.children);
      if (children === candidate.children) return candidate;
      changed = true;
      return { ...candidate, children };
    });
    return changed ? next : nodes;
  };

  const next = insertBelowParent(withoutDuplicate);
  return inserted ? next : [...next, node];
}

export function updateFolderInTree(
  nodes: FolderTreeNode[] | undefined,
  folderId: string,
  updates: Partial<Folder>,
): FolderTreeNode[] | undefined {
  if (!nodes) return nodes;

  const existing = findFolderInTree(nodes, folderId);
  if (!existing) return nodes;
  if (updates.parentId !== undefined && updates.parentId !== existing.parentId) {
    const withoutExisting = removeFolderFromTree(nodes, folderId) ?? [];
    const moved = { ...existing, ...updates, children: existing.children };
    if (moved.parentId === null) return [moved, ...withoutExisting];

    let inserted = false;
    const insertBelowParent = (folders: FolderTreeNode[]): FolderTreeNode[] => {
      let changed = false;
      const next = folders.map((folder) => {
        if (folder.id === moved.parentId) {
          inserted = true;
          changed = true;
          return { ...folder, children: [...folder.children, moved] };
        }
        const children = insertBelowParent(folder.children);
        if (children === folder.children) return folder;
        changed = true;
        return { ...folder, children };
      });
      return changed ? next : folders;
    };
    const relocated = insertBelowParent(withoutExisting);
    return inserted ? relocated : [...relocated, moved];
  }

  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === folderId) {
      changed = true;
      return { ...node, ...updates, children: node.children };
    }
    const children = updateFolderInTree(node.children, folderId, updates) ?? node.children;
    if (children !== node.children) {
      changed = true;
      return { ...node, children };
    }
    return node;
  });
  return changed ? next : nodes;
}

export function collectFolderSubtreeIds(
  nodes: FolderTreeNode[] | undefined,
  folderId: string,
): Set<string> {
  const result = new Set<string>();
  const collect = (node: FolderTreeNode) => {
    result.add(node.id);
    for (const child of node.children) collect(child);
  };
  const find = (folders: FolderTreeNode[]): boolean => {
    for (const folder of folders) {
      if (folder.id === folderId) {
        collect(folder);
        return true;
      }
      if (find(folder.children)) return true;
    }
    return false;
  };
  find(nodes ?? []);
  if (result.size === 0) result.add(folderId);
  return result;
}

export function removeFolderFromTree(
  nodes: FolderTreeNode[] | undefined,
  folderId: string,
): FolderTreeNode[] | undefined {
  if (!nodes) return nodes;

  let changed = false;
  const next: FolderTreeNode[] = [];
  for (const node of nodes) {
    if (node.id === folderId) {
      changed = true;
      continue;
    }
    const children = removeFolderFromTree(node.children, folderId) ?? node.children;
    if (children !== node.children) changed = true;
    next.push(children === node.children ? node : { ...node, children });
  }
  return changed ? next : nodes;
}
