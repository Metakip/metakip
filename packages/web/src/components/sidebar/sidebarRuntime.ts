import type { SharePermission } from '@metakip/shared';
import type { KeyboardEvent } from 'react';
import type { SidebarCapabilities, SidebarPlacement } from './sidebarCapabilities';

export type SidebarEditingTarget =
  | { kind: 'page'; id: string; value: string }
  | { kind: 'folder'; id: string; value: string }
  | null;

export type SidebarEntityAuthorization = {
  ownerId?: string | null | undefined;
  createdBy?: string | null | undefined;
  userPermission?: SharePermission | null | undefined;
  parentId?: string | null | undefined;
};

export type SidebarTreeRuntime = {
  activePageId?: string | undefined;
  expandedFolderIds: ReadonlySet<string>;
  editingTarget: SidebarEditingTarget;
  getCapabilities: (
    entityType: 'page' | 'folder',
    entityId: string,
    placement: SidebarPlacement,
    sourceIsAdmin: boolean,
  ) => SidebarCapabilities;
  getAuthorization: (
    entityType: 'page' | 'folder',
    entityId: string,
  ) => SidebarEntityAuthorization | undefined;
  isFavoriteEntity: (entityType: 'page' | 'folder', entityId: string) => boolean;
  toggleFolderExpanded: (folderId: string) => void;
  createPageInFolder: (folderId: string) => void;
  startEditing: (kind: 'page' | 'folder', id: string, value: string) => void;
  setEditingValue: (kind: 'page' | 'folder', id: string, value: string) => void;
  saveRename: () => void;
  onRenameKeyDown: (event: KeyboardEvent) => void;
};
