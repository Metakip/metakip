import type { SharePermission } from '@metakip/shared';
import { PageTreeRow } from './PageTreeRow';
import type { SidebarPlacement } from './sidebarCapabilities';
import type { SidebarTreeRuntime } from './sidebarRuntime';

export type SidebarRowModel = {
  entityType: 'page' | 'folder';
  id: string;
  title: string;
  icon?: string | null | undefined;
  ownerId?: string | null | undefined;
  createdBy?: string | null | undefined;
  userPermission?: SharePermission | null | undefined;
  parentId?: string | null | undefined;
  shareSource?: 'direct' | 'public' | 'workspace' | undefined;
};

type SidebarEntityRowProps = {
  runtime: SidebarTreeRuntime;
  entity: SidebarRowModel;
  placement: SidebarPlacement;
  sourceIsAdmin?: boolean | undefined;
  depth?: number | undefined;
  hasChildren?: boolean | undefined;
  isExpanded?: boolean | undefined;
};

export function SidebarEntityRow({
  runtime,
  entity,
  placement,
  sourceIsAdmin = false,
  depth = 0,
  hasChildren = false,
  isExpanded = false,
}: SidebarEntityRowProps) {
  const capabilities = runtime.getCapabilities(
    entity.entityType,
    entity.id,
    placement,
    sourceIsAdmin,
  );
  const authorization = runtime.getAuthorization(entity.entityType, entity.id);
  const canRename = capabilities.canRename;
  const isEditing =
    canRename &&
    runtime.editingTarget?.kind === entity.entityType &&
    runtime.editingTarget.id === entity.id;
  const isFolder = entity.entityType === 'folder';

  return (
    <PageTreeRow
      id={entity.id}
      title={entity.title}
      icon={entity.icon}
      ownerId={authorization ? authorization.ownerId : entity.ownerId}
      createdBy={authorization ? authorization.createdBy : entity.createdBy}
      userPermission={authorization ? authorization.userPermission : entity.userPermission}
      shareSource={entity.shareSource}
      parentId={authorization ? authorization.parentId : entity.parentId}
      canMove={capabilities.canMove}
      depth={depth}
      isActive={runtime.activePageId === entity.id}
      isFavorite={runtime.isFavoriteEntity(entity.entityType, entity.id)}
      hasChildren={hasChildren}
      isExpanded={isExpanded}
      isFolder={isFolder}
      onToggleExpand={isFolder ? () => runtime.toggleFolderExpanded(entity.id) : undefined}
      onCreateChild={
        isFolder && capabilities.canCreateChild
          ? () => runtime.createPageInFolder(entity.id)
          : undefined
      }
      onRename={
        canRename
          ? () => runtime.startEditing(entity.entityType, entity.id, entity.title)
          : undefined
      }
      isEditing={isEditing}
      editTitle={isEditing ? (runtime.editingTarget?.value ?? entity.title) : entity.title}
      onEditChange={(value) => runtime.setEditingValue(entity.entityType, entity.id, value)}
      onEditSave={runtime.saveRename}
      onEditKeyDown={runtime.onRenameKeyDown}
    />
  );
}
