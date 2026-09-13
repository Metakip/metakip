import type { FolderTreeNode, PageTreeNode, SharedNavigationItem } from '@metakip/shared';
import { SidebarEntityRow } from './SidebarEntityRow';
import type { SidebarTreeRuntime } from './sidebarRuntime';

function TreePageRow({
  page,
  placement,
  depth,
  sourceIsAdmin,
  runtime,
}: {
  page: PageTreeNode;
  placement: 'owned' | 'workspace';
  depth: number;
  sourceIsAdmin: boolean;
  runtime: SidebarTreeRuntime;
}) {
  return (
    <SidebarEntityRow
      runtime={runtime}
      entity={{
        entityType: 'page',
        id: page.id,
        title: page.title,
        icon: page.icon,
        ownerId: page.ownerId,
        createdBy: page.createdBy,
        userPermission: page.userPermission,
        ...(placement === 'workspace' ? { shareSource: 'workspace' as const } : {}),
        parentId: page.parentId,
      }}
      placement={placement}
      sourceIsAdmin={sourceIsAdmin}
      depth={depth}
    />
  );
}

export function OwnedFolderBranch({
  folder,
  depth = 0,
  foldersByParent,
  pagesByFolder,
  runtime,
}: {
  folder: FolderTreeNode;
  depth?: number;
  foldersByParent: ReadonlyMap<string | null, FolderTreeNode[]>;
  pagesByFolder: ReadonlyMap<string | null, PageTreeNode[]>;
  runtime: SidebarTreeRuntime;
}) {
  const childFolders = foldersByParent.get(folder.id) ?? [];
  const childPages = pagesByFolder.get(folder.id) ?? [];
  const expanded = runtime.expandedFolderIds.has(folder.id);
  return (
    <div>
      <SidebarEntityRow
        runtime={runtime}
        entity={{
          entityType: 'folder',
          id: folder.id,
          title: folder.name,
          icon: folder.icon,
          ownerId: folder.ownerId,
          createdBy: folder.createdBy,
          userPermission: folder.userPermission,
          parentId: folder.parentId,
        }}
        placement="owned"
        depth={depth}
        hasChildren={childFolders.length > 0 || childPages.length > 0}
        isExpanded={expanded}
      />
      {expanded && (
        <>
          {childFolders.map((child) => (
            <OwnedFolderBranch
              key={child.id}
              folder={child}
              depth={depth + 1}
              foldersByParent={foldersByParent}
              pagesByFolder={pagesByFolder}
              runtime={runtime}
            />
          ))}
          {childPages.map((page) => (
            <TreePageRow
              key={page.id}
              page={page}
              placement="owned"
              depth={depth + 1}
              sourceIsAdmin={false}
              runtime={runtime}
            />
          ))}
        </>
      )}
    </div>
  );
}

export function WorkspacePageRow({
  page,
  depth = 0,
  sourceIsAdmin = false,
  runtime,
}: {
  page: PageTreeNode;
  depth?: number;
  sourceIsAdmin?: boolean;
  runtime: SidebarTreeRuntime;
}) {
  return (
    <TreePageRow
      page={page}
      placement="workspace"
      depth={depth}
      sourceIsAdmin={sourceIsAdmin}
      runtime={runtime}
    />
  );
}

export function WorkspaceFolderBranch({
  folder,
  workspaceOwnerId,
  allPagesByFolder,
  depth = 0,
  sourceIsAdmin = false,
  runtime,
}: {
  folder: FolderTreeNode;
  workspaceOwnerId: string;
  allPagesByFolder: ReadonlyMap<string | null, PageTreeNode[]>;
  depth?: number;
  sourceIsAdmin?: boolean;
  runtime: SidebarTreeRuntime;
}) {
  const childFolders = (folder.children ?? []).filter(
    (child) => child.ownerId === workspaceOwnerId && child.workspaceAccess === true,
  );
  const childPages = (allPagesByFolder.get(folder.id) ?? []).filter(
    (page) => page.ownerId === workspaceOwnerId && page.workspaceAccess === true,
  );
  const expanded = runtime.expandedFolderIds.has(folder.id);
  const isAdmin = folder.userPermission === 'admin';
  return (
    <div>
      <SidebarEntityRow
        runtime={runtime}
        entity={{
          entityType: 'folder',
          id: folder.id,
          title: folder.name,
          icon: folder.icon,
          ownerId: folder.ownerId,
          createdBy: folder.createdBy,
          userPermission: folder.userPermission,
          shareSource: 'workspace',
          parentId: folder.parentId,
        }}
        placement="workspace"
        sourceIsAdmin={sourceIsAdmin}
        depth={depth}
        hasChildren={childFolders.length > 0 || childPages.length > 0}
        isExpanded={expanded}
      />
      {expanded && (
        <>
          {childFolders.map((child) => (
            <WorkspaceFolderBranch
              key={child.id}
              folder={child}
              workspaceOwnerId={workspaceOwnerId}
              allPagesByFolder={allPagesByFolder}
              depth={depth + 1}
              sourceIsAdmin={isAdmin}
              runtime={runtime}
            />
          ))}
          {childPages.map((page) => (
            <WorkspacePageRow
              key={page.id}
              page={page}
              depth={depth + 1}
              sourceIsAdmin={isAdmin}
              runtime={runtime}
            />
          ))}
        </>
      )}
    </div>
  );
}

export function SharedNavigationBranch({
  item,
  depth = 0,
  sourceIsAdmin = false,
  runtime,
}: {
  item: SharedNavigationItem;
  depth?: number;
  sourceIsAdmin?: boolean;
  runtime: SidebarTreeRuntime;
}) {
  if (item.entityType === 'page') {
    return (
      <SidebarEntityRow
        runtime={runtime}
        entity={{
          entityType: 'page',
          id: item.id,
          title: item.title,
          icon: item.icon,
          ownerId: item.ownerId,
          createdBy: item.createdBy,
          userPermission: item.userPermission,
          shareSource: item.source,
          parentId: item.parentId,
        }}
        placement="shared"
        sourceIsAdmin={sourceIsAdmin}
        depth={depth}
      />
    );
  }

  const expanded = runtime.expandedFolderIds.has(item.id);
  return (
    <div>
      <SidebarEntityRow
        runtime={runtime}
        entity={{
          entityType: 'folder',
          id: item.id,
          title: item.title,
          icon: item.icon,
          ownerId: item.ownerId,
          createdBy: item.createdBy,
          userPermission: item.userPermission,
          shareSource: item.source,
          parentId: item.parentId,
        }}
        placement="shared"
        sourceIsAdmin={sourceIsAdmin}
        depth={depth}
        hasChildren={item.children.length > 0}
        isExpanded={expanded}
      />
      {expanded &&
        item.children.map((child) => (
          <SharedNavigationBranch
            key={`${child.entityType}-${child.id}`}
            item={child}
            depth={depth + 1}
            sourceIsAdmin={item.userPermission === 'admin'}
            runtime={runtime}
          />
        ))}
    </div>
  );
}
