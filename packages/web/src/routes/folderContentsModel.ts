import type {
  FolderChildDto,
  FolderDetailPayload,
  FolderPageDto,
  FolderTreeNode,
  PageTreeNode,
} from '@metakip/shared';
import { getPagesInFolder } from '../utils/page-tree';

function toDate(value: string | Date | null | undefined): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function toPublicPage(page: FolderPageDto, folderId: string): PageTreeNode {
  return {
    id: page.id,
    parentId: folderId,
    title: page.title,
    icon: page.icon,
    coverType: null,
    coverValue: null,
    position: '0',
    properties: null,
    createdBy: page.accessScope === 'account' ? page.createdBy : null,
    ownerId: page.accessScope === 'account' ? page.ownerId : null,
    createdAt: toDate(page.updatedAt),
    updatedAt: toDate(page.updatedAt),
    publicPermission: page.publicPermission,
    userPermission: page.userPermission,
    children: [],
  };
}

function toPublicFolder(folder: FolderChildDto, parentId: string | null): FolderTreeNode {
  return {
    id: folder.id,
    parentId,
    name: folder.name,
    icon: folder.icon,
    position: '0',
    createdBy: folder.accessScope === 'account' ? folder.createdBy : null,
    createdAt: toDate(folder.updatedAt),
    updatedAt: toDate(folder.updatedAt),
    ownerId: folder.accessScope === 'account' ? folder.ownerId : null,
    publicPermission: folder.publicPermission,
    userPermission: folder.userPermission,
    children: [],
  };
}

function toPublicFolderTree(folder: FolderDetailPayload): FolderTreeNode {
  return {
    ...toPublicFolder(folder, null),
    children: folder.folders.map((child) => toPublicFolder(child, folder.id)),
  };
}

export function findFolderById(
  nodes: FolderTreeNode[] | undefined,
  folderId: string | undefined,
): FolderTreeNode | null {
  if (!nodes || !folderId) return null;
  for (const node of nodes) {
    if (node.id === folderId) return node;
    const found = findFolderById(node.children, folderId);
    if (found) return found;
  }
  return null;
}

export type FolderContentsModel = {
  currentFolder: FolderTreeNode | null;
  currentFolders: FolderTreeNode[];
  currentPages: PageTreeNode[];
  publicFolder: FolderTreeNode | null;
  usesPublicPayload: boolean;
};

export function getFolderContentsModel({
  folderId,
  folders,
  pages,
  publicEntity,
  isAnonymous,
}: {
  folderId: string | undefined;
  folders: FolderTreeNode[] | undefined;
  pages: PageTreeNode[] | undefined;
  publicEntity: FolderDetailPayload | null;
  isAnonymous: boolean;
}): FolderContentsModel {
  const treeFolder = findFolderById(folders, folderId);
  const usesPublicPayload = Boolean(
    folderId && publicEntity?.id === folderId && (isAnonymous || !treeFolder),
  );
  const polledFolder =
    publicEntity && publicEntity.id === folderId ? toPublicFolderTree(publicEntity) : null;
  const publicFolder = usesPublicPayload ? polledFolder : null;
  const currentFolder = polledFolder ?? treeFolder;
  return {
    currentFolder,
    currentFolders: publicFolder
      ? publicFolder.children
      : folderId
        ? (treeFolder?.children ?? [])
        : (folders ?? []),
    currentPages:
      publicFolder && folderId
        ? (publicEntity?.pages.map((page) => toPublicPage(page, folderId)) ?? [])
        : getPagesInFolder(pages ?? [], folderId ?? null),
    publicFolder,
    usesPublicPayload,
  };
}
