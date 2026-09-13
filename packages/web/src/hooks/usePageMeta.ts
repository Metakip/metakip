import {
  HocuspocusProvider,
  type onAuthenticationFailedParameters,
  type onCloseParameters,
} from '@hocuspocus/provider';
import {
  COLLAB_TERMINAL_REASONS,
  getPageMetaRoomName,
  type PageMetaStatelessMessage,
} from '@metakip/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { useIdentityLifecycle, useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { authClient } from '../lib/auth-client';
import { retireQueryClient } from '../lib/query-client';
import { getLogger } from '../logger-init';
import { isBulkRemovalInProgress } from '../utils/bulkRemovalState';
import { getCollaborationUrl } from '../utils/collaborationUrl';
import { formatGrantNotification } from '../utils/grantNotification';
import { showInfoToast } from '../utils/toast';
import { getWorkspacePath, getWorkspacePathPrefix } from '../utils/url';
import { shareQueryKeys } from './use-share';
import { invalidateWorkspaceAccessQueries, WORKSPACE_ACCESS_QUERY_KEYS } from './use-workspace';
import { useAuth } from './useAuth';

const COLLAB_URL = getCollaborationUrl();
function isTerminalMetaClose({ event }: onCloseParameters): boolean {
  return (
    event.code === 4401 ||
    event.code === 4500 ||
    event.reason === COLLAB_TERMINAL_REASONS.ACCESS_REVOKED ||
    event.reason === COLLAB_TERMINAL_REASONS.SESSION_EXPIRED ||
    event.reason === COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED
  );
}

const PAGE_META_SYNC_QUERY_KEYS = [...WORKSPACE_ACCESS_QUERY_KEYS] as const;

export async function refreshPageMetaQueriesAfterSync(queryClient: QueryClient): Promise<void> {
  if (isBulkRemovalInProgress()) return;

  // An initial dashboard request may have started before the meta room
  // connected. Cancel it before refetching so its older snapshot cannot
  // swallow a grant or permission change received during startup.
  await Promise.all(
    PAGE_META_SYNC_QUERY_KEYS.map((queryKey) => queryClient.cancelQueries({ queryKey })),
  );
  if (isBulkRemovalInProgress()) return;

  await Promise.all(
    PAGE_META_SYNC_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

export function applyPageMetaStatelessMessage(
  message: PageMetaStatelessMessage,
  queryClient: QueryClient,
  pathname: string,
  suppressAccessInvalidation = false,
): boolean {
  if (message.type === 'entity_deleted') {
    queryClient.removeQueries({
      queryKey: ['folders', 'detail', message.entityId],
      exact: true,
    });
    queryClient.removeQueries({
      queryKey: shareQueryKeys.summary('folder', message.entityId),
      exact: true,
    });
  }
  const refreshHandledByAccessVersion =
    (message.type === 'grant_received' || message.type === 'workspace_membership_event') &&
    message.refreshViaAccessVersion === true;
  if (!suppressAccessInvalidation && !refreshHandledByAccessVersion) {
    invalidateWorkspaceAccessQueries(queryClient);
    if (message.type === 'share_access_event' || message.type === 'entity_deleted') {
      queryClient.invalidateQueries({ queryKey: ['pages', 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['folders', 'detail'] });
    }
  }
  return (
    message.type === 'entity_deleted' &&
    pathname.startsWith(`${getWorkspacePathPrefix()}folder/`) &&
    pathname.endsWith(message.entityId)
  );
}

export function parsePageMetaStatelessMessage(payload: string): PageMetaStatelessMessage | null {
  const trimmed = payload.trim();
  if (!trimmed.startsWith('{')) return null;

  let message: unknown;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    throw new Error('Malformed stateless message', { cause: error });
  }
  if (!message || typeof message !== 'object' || !('type' in message)) return null;
  if (message.type === 'entity_deleted') {
    const entityType = 'entityType' in message ? message.entityType : undefined;
    const entityId = 'entityId' in message ? message.entityId : undefined;
    if (entityType !== 'folder' || typeof entityId !== 'string' || entityId.length === 0) {
      throw new Error('Malformed folder deletion event');
    }
    return { type: 'entity_deleted', entityType, entityId };
  }
  if (message.type === 'share_access_event') {
    const action = 'action' in message ? message.action : undefined;
    const entityType = 'entityType' in message ? message.entityType : undefined;
    const entityId = 'entityId' in message ? message.entityId : undefined;
    if (
      (action !== 'grant' &&
        action !== 'update' &&
        action !== 'revoke' &&
        action !== 'recompute') ||
      (entityType !== 'page' && entityType !== 'folder') ||
      typeof entityId !== 'string' ||
      entityId.length === 0
    ) {
      throw new Error('Malformed share access event');
    }
    return { type: 'share_access_event', action, entityType, entityId };
  }
  if (message.type === 'grant_received') {
    const entityType = 'entityType' in message ? message.entityType : undefined;
    const entityId = 'entityId' in message ? message.entityId : undefined;
    const entityTitle = 'entityTitle' in message ? message.entityTitle : undefined;
    const sharedByName = 'sharedByName' in message ? message.sharedByName : undefined;
    const eventMessage = 'message' in message ? message.message : undefined;
    const refreshViaAccessVersion =
      'refreshViaAccessVersion' in message ? message.refreshViaAccessVersion : undefined;
    if (
      (entityType !== 'page' && entityType !== 'folder') ||
      typeof entityId !== 'string' ||
      entityId.length === 0 ||
      typeof entityTitle !== 'string' ||
      typeof sharedByName !== 'string' ||
      (eventMessage !== undefined && typeof eventMessage !== 'string') ||
      (refreshViaAccessVersion !== undefined && refreshViaAccessVersion !== true)
    ) {
      throw new Error('Malformed grant event');
    }
    return {
      type: 'grant_received',
      entityType,
      entityId,
      entityTitle,
      sharedByName,
      ...(eventMessage !== undefined && { message: eventMessage }),
      ...(refreshViaAccessVersion === true && { refreshViaAccessVersion: true }),
    };
  }
  if (message.type !== 'workspace_membership_event') return null;

  const action = 'action' in message ? message.action : undefined;
  const ownerId = 'ownerId' in message ? message.ownerId : undefined;
  const refreshViaAccessVersion =
    'refreshViaAccessVersion' in message ? message.refreshViaAccessVersion : undefined;
  if (
    (action !== 'member_added' && action !== 'member_removed' && action !== 'role_changed') ||
    typeof ownerId !== 'string' ||
    ownerId.length === 0 ||
    (refreshViaAccessVersion !== undefined && refreshViaAccessVersion !== true)
  ) {
    throw new Error('Malformed workspace membership event');
  }
  return {
    type: 'workspace_membership_event',
    action,
    ownerId,
    ...(refreshViaAccessVersion === true && { refreshViaAccessVersion: true }),
  };
}

/**
 * Connects to the user meta room (a shared Yjs document indexed by
 * user ID) that contains:
 *   - `pageIndex`: a map of `{ pageId -> { title, icon, parentId, position } }`
 *   - `backlinksVersion`: a map of `{ pageId -> timestamp }` bumped whenever
 *     a page's connections are rebuilt, so clients can refetch backlinks.
 *
 * The meta room is populated server-side by `updatePageMeta()` and
 * `updateBacklinksVersion()` on every page persist.
 */
export function usePageMeta() {
  const queryClient = useQueryClient();
  const navigate = useIdentityNavigate();
  const identityLifecycle = useIdentityLifecycle();
  const { data: session, refetch: refetchSession } = useAuth();
  const userId = session?.user?.id;

  const refetchSessionRef = useRef(refetchSession);
  refetchSessionRef.current = refetchSession;

  useEffect(() => {
    if (!userId || !identityLifecycle.isActive()) return undefined;

    const doc = new Y.Doc();
    const map = doc.getMap('pageIndex');
    let hasTerminatedIdentity = false;

    const terminateIdentity = (reason: string) => {
      if (hasTerminatedIdentity || !identityLifecycle.isActive()) return;
      hasTerminatedIdentity = true;
      getLogger().warn('Page metadata authentication ended; retiring identity state', { reason });
      // Navigation must run before retirement because useIdentityNavigate is
      // intentionally inert for a retired identity. Clearing and retiring the
      // identity-scoped client immediately prevents already-rendered private
      // metadata (and pending mutation callbacks) from surviving until the
      // authoritative session request resolves.
      navigate('/login', { replace: true });
      identityLifecycle.retire();
      retireQueryClient(queryClient);
      void Promise.resolve(refetchSessionRef.current()).catch((error: unknown) => {
        getLogger().error('Failed to refresh session after page metadata authentication ended', {
          error: String(error),
        });
      });
    };

    const handleClose = (parameters: onCloseParameters) => {
      if (!isTerminalMetaClose(parameters)) return;
      terminateIdentity(parameters.event.reason || `close code ${parameters.event.code}`);
    };

    const handleAuthenticationFailed = ({ reason }: onAuthenticationFailedParameters) => {
      terminateIdentity(reason || 'authentication failed');
    };

    const provider = new HocuspocusProvider({
      url: COLLAB_URL,
      name: getPageMetaRoomName(userId),
      document: doc,
      onClose: handleClose,
      onAuthenticationFailed: handleAuthenticationFailed,
      token: async () => {
        const s = await authClient.getSession();
        const token = s.data?.session?.token ?? '';
        const sessionUserId = s.data?.user?.id ?? '';
        if (!identityLifecycle.isActive() || !token || sessionUserId !== userId) {
          throw new Error('Page metadata identity changed or is unavailable');
        }
        return token;
      },
    });

    // Configuration callbacks can fire while the provider is being
    // constructed. Do not attach observers or restore the module-level map
    // after a synchronous authentication rejection/terminal close.
    if (hasTerminatedIdentity) {
      provider.destroy();
      doc.destroy();
      return undefined;
    }

    // Observe backlinksVersion bumps emitted by the collab server after
    // every persist. When a version changes, invalidate TanStack Query
    // for that page's backlinks and outgoing links so the panel refetches.
    const bv = doc.getMap<number>('backlinksVersion');
    const bvObserver = () => {
      if (!identityLifecycle.isActive()) return;
      queryClient.invalidateQueries({ queryKey: ['backlinks'] });
    };
    bv.observe(bvObserver);

    // Debounced page tree invalidation on pageIndex changes from the collab
    // server, so the sidebar stays in sync across users.
    const pageTreeTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
    const pageIndexInitialRef = { current: true };
    const pageIndexObserver = () => {
      if (!identityLifecycle.isActive()) return;
      if (pageIndexInitialRef.current) {
        pageIndexInitialRef.current = false;
        return;
      }
      if (pageTreeTimerRef.current) clearTimeout(pageTreeTimerRef.current);
      if (isBulkRemovalInProgress()) return;
      pageTreeTimerRef.current = setTimeout(() => {
        if (identityLifecycle.isActive() && !isBulkRemovalInProgress()) {
          queryClient.invalidateQueries({ queryKey: ['pageTree'] });
        }
      }, 1000);
    };
    map.observe(pageIndexObserver);

    const handleSynced = () => {
      if (!identityLifecycle.isActive()) return;
      if (isBulkRemovalInProgress()) return;
      // LISTEN/NOTIFY events are intentionally not retained. Rebuild all
      // access-sensitive queries after each meta-room handshake so a change
      // that happened during startup or a reconnect cannot leave stale UI.
      void refreshPageMetaQueriesAfterSync(queryClient).catch((error: unknown) => {
        getLogger().error('Failed to refresh access after page metadata sync', {
          error: String(error),
        });
      });
    };
    provider.on('synced', handleSynced);
    const accessVersion = doc.getMap<number>('accessVersion');
    accessVersion.observe(handleSynced);
    let reconnectAfterDisconnect: (() => void) | null = null;

    const handleStateless = ({ payload }: { payload: string }) => {
      if (!identityLifecycle.isActive()) return;
      let message: PageMetaStatelessMessage | null;
      try {
        message = parsePageMetaStatelessMessage(payload);
      } catch (error) {
        getLogger().error('Malformed page metadata message; reconnecting', {
          error: String(error),
        });
        if (!reconnectAfterDisconnect) {
          reconnectAfterDisconnect = () => {
            if (!reconnectAfterDisconnect) return;
            provider.off('disconnect', reconnectAfterDisconnect);
            reconnectAfterDisconnect = null;
            void provider.connect();
          };
          provider.on('disconnect', reconnectAfterDisconnect);
        }
        provider.disconnect();
        return;
      }
      if (!message) return;

      if (message.type === 'grant_received') {
        showInfoToast(formatGrantNotification(message.sharedByName, message.entityTitle));
      }

      if (
        applyPageMetaStatelessMessage(
          message,
          queryClient,
          window.location.pathname,
          isBulkRemovalInProgress(),
        )
      ) {
        navigate(getWorkspacePath(), { replace: true });
      }
    };
    provider.on('stateless', handleStateless);

    return () => {
      if (pageTreeTimerRef.current) clearTimeout(pageTreeTimerRef.current);
      try {
        bv.unobserve(bvObserver);
      } catch {
        // already detached
      }
      try {
        map.unobserve(pageIndexObserver);
      } catch {
        // already detached
      }
      accessVersion.unobserve(handleSynced);
      provider.off('synced', handleSynced);
      if (reconnectAfterDisconnect) provider.off('disconnect', reconnectAfterDisconnect);
      provider.off('stateless', handleStateless);
      provider.destroy();
      doc.destroy();
    };
  }, [userId, queryClient, navigate, identityLifecycle]);
}
