import type {
  PageDetailPayload,
  SharedNavigationItem,
  SharedNavigationPage,
  SharePermission,
} from '@metakip/shared';
import {
  canMoveEntity,
  type EntityShareSource,
  isOwnedByUser,
  resolveRemovalShareSource,
} from '../utils/entity-actions';
import { findFolderInTree } from '../utils/treeCache';
import { useFolderTree } from './use-folders';
import { usePageTree } from './use-pages';
import { useSharedWithMeTree } from './use-shared-with-me';
import { useWorkspaceMemberships } from './use-workspace';
import { useAuth } from './useAuth';

type ActionAvailability = 'unresolved' | 'allowed' | 'denied';

type PageActionEligibility = {
  move: ActionAvailability;
  removal:
    | { status: 'unresolved' }
    | { status: 'ready'; shareSource: EntityShareSource | undefined };
};

function findSharedPage(
  items: SharedNavigationItem[],
  pageId: string,
): SharedNavigationPage | undefined {
  for (const item of items) {
    if (item.entityType === 'page' && item.id === pageId) return item;
    if (item.entityType === 'folder') {
      const page = findSharedPage(item.children, pageId);
      if (page) return page;
    }
  }
  return undefined;
}

export function usePageActionEligibility(
  page: PageDetailPayload,
  permission: SharePermission | null,
  enabled: boolean,
): PageActionEligibility {
  const { data: session } = useAuth();
  const userId = session?.user?.id;
  const parentId = page.accessScope === 'account' ? page.parentId : null;
  const pages = usePageTree({ enabled });
  const shared = useSharedWithMeTree(undefined, { enabled });
  const folders = useFolderTree({ enabled: enabled && parentId !== null });
  const memberships = useWorkspaceMemberships({ enabled: enabled && parentId === null });
  const workspaceAccess =
    pages.isSuccess && pages.data.some((item) => item.id === page.id && item.workspaceAccess);

  let move: ActionAvailability = 'unresolved';
  if (page.accessScope === 'public') {
    move = 'denied';
  } else if (userId) {
    if (isOwnedByUser(page, userId)) {
      move = 'allowed';
    } else if (!page.ownerId || permission !== 'admin') {
      move = 'denied';
    } else if (page.parentId !== null) {
      if (folders.isSuccess) {
        const source = findFolderInTree(folders.data, page.parentId);
        move = canMoveEntity(permission, source?.userPermission === 'admin') ? 'allowed' : 'denied';
      }
    } else if (memberships.isSuccess) {
      const sourceIsAdmin = memberships.data.some(
        (membership) => membership.ownerId === page.ownerId && membership.role === 'admin',
      );
      move = canMoveEntity(permission, sourceIsAdmin) ? 'allowed' : 'denied';
    }
  }

  return {
    move,
    removal:
      pages.isSuccess && shared.isSuccess
        ? {
            status: 'ready',
            shareSource: resolveRemovalShareSource(
              findSharedPage(shared.data, page.id)?.source,
              workspaceAccess,
            ),
          }
        : { status: 'unresolved' },
  };
}
