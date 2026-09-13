import type { Server } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import type { ShareEventPayload, WorkspaceMembershipMessage } from '@metakip/shared';
import { Client, type Pool } from 'pg';
import { createCoalescingTaskQueue } from './coalescingTaskQueue';
import {
  type GrantReceivedPayload,
  parseGrantReceivedPayload,
  parseNotificationJson,
  parseShareEventPayload,
  parseWorkspaceEventPayload,
  type WorkspaceEventPayload,
} from './notificationPayloads';
import { getActiveMetaDocuments } from './pageMetadata';
import {
  handleShareEvent,
  handleWorkspaceEvent,
  revalidateActivePageConnections,
} from './permission-handler';
import { broadcastWikiLinkPresentationInvalidation } from './wikiLinkInvalidation';

const DELETION_EVENT_QUEUE_LIMIT = 256;
const GRANT_EVENT_QUEUE_LIMIT = 256;
const PAGE_CONTENT_EVENT_QUEUE_LIMIT = 256;
const PAGE_RENAME_EVENT_QUEUE_LIMIT = 256;
const SHARE_EVENT_QUEUE_LIMIT = 256;
const WORKSPACE_EVENT_QUEUE_LIMIT = 256;
const MAX_RECONNECT_DELAY = 30_000;
const LISTEN_CONNECT_TIMEOUT_MS = 10_000;

type MetadataRebuildOptions = {
  invalidateBacklinks?: boolean;
  bumpAccessVersion?: boolean;
  reconcileTitles?: boolean;
};

type NotificationPublications = {
  grantReceived(payload: GrantReceivedPayload): Promise<void>;
  pageContentReplaced(pageId: string): Promise<void>;
  pageRenamed(pageId: string): Promise<void>;
  pageDeleted(pageId: string): Promise<void>;
  folderDeleted(folderId: string): Promise<void>;
  rebuildMetadata(options?: MetadataRebuildOptions): Promise<void>;
  reconcileAll(): Promise<void>;
  reconcileContent(): Promise<void>;
  reconcileDeletions(): Promise<void>;
};

type NotificationRuntimeOptions = {
  server: Server;
  pool: Pool;
  logger: Logger;
  databaseUrl?: string;
  permissionRevalidationMs: number;
  publications: NotificationPublications;
  createListenClient?: ((databaseUrl: string) => Client) | undefined;
};

export function getShareEventQueueKey(payload: ShareEventPayload): string {
  return JSON.stringify([
    payload.entityType,
    payload.entityId,
    payload.targetUserId ?? null,
    payload.metaOnly === true ? 'meta' : 'permission',
  ]);
}

export function mergeShareEventMetadata(
  existing: ShareEventPayload,
  incoming: ShareEventPayload,
): ShareEventPayload {
  const metaUserIds = [
    ...new Set([...(existing.metaUserIds ?? []), ...(incoming.metaUserIds ?? [])]),
  ];
  return { ...incoming, ...(metaUserIds.length > 0 ? { metaUserIds } : {}) };
}

export function installNotificationRuntime({
  server,
  pool,
  logger,
  databaseUrl,
  permissionRevalidationMs,
  publications,
  createListenClient = (connectionString) =>
    new Client({ connectionString, connectionTimeoutMillis: LISTEN_CONNECT_TIMEOUT_MS }),
}: NotificationRuntimeOptions): () => Promise<void> {
  const shareEventQueue = createCoalescingTaskQueue<ShareEventPayload>({
    maxPending: SHARE_EVENT_QUEUE_LIMIT,
    getKey: getShareEventQueueKey,
    mergePending: mergeShareEventMetadata,
    handle: async (payload) => {
      await handleShareEvent(server, payload, pool, logger);
      await broadcastWikiLinkPresentationInvalidation(
        server.hocuspocus,
        pool,
        payload.entityType === 'page'
          ? { targetPageIds: [payload.entityId] }
          : { folderId: payload.entityId },
        payload.targetUserId ? { recipientUserId: payload.targetUserId } : {},
      );
    },
    handleOverflow: async () => {
      logger.warn(
        `[listen] share event backlog exceeded ${SHARE_EVENT_QUEUE_LIMIT}; rebuilding active collaboration state`,
      );
      await Promise.all([
        publications.rebuildMetadata({ reconcileTitles: false }),
        revalidateActivePageConnections(server, pool, logger),
      ]);
    },
    onError: (error) => logger.error(`[listen] handleShareEvent failed: ${error}`),
  });
  const grantEventQueue = createCoalescingTaskQueue<GrantReceivedPayload>({
    maxPending: GRANT_EVENT_QUEUE_LIMIT,
    getKey: (payload) => `${payload.targetUserId}:${payload.entityType}:${payload.entityId}`,
    handle: publications.grantReceived,
    handleOverflow: async () => {
      logger.warn(
        `[listen] dropped best-effort grant notifications after backlog exceeded ${GRANT_EVENT_QUEUE_LIMIT}; rebuilding canonical access metadata`,
      );
      await publications.rebuildMetadata({ reconcileTitles: false });
    },
    onError: (error) => logger.error(`[listen] handleGrantReceived failed: ${error}`),
  });
  const workspaceEventQueue = createCoalescingTaskQueue<WorkspaceEventPayload>({
    maxPending: WORKSPACE_EVENT_QUEUE_LIMIT,
    getKey: (payload) => `${payload.ownerId}:${payload.memberId}`,
    handle: async (payload) => {
      await handleWorkspaceEvent(server, payload, pool, logger);
      await broadcastWikiLinkPresentationInvalidation(
        server.hocuspocus,
        pool,
        { workspaceOwnerId: payload.ownerId },
        { recipientUserId: payload.memberId },
      );
    },
    handleOverflow: async () => {
      logger.warn(
        `[listen] workspace event backlog exceeded ${WORKSPACE_EVENT_QUEUE_LIMIT}; rebuilding active collaboration state`,
      );
      const message = JSON.stringify({
        type: 'workspace_membership_event',
        action: 'role_changed',
        ownerId: 'all',
      } satisfies WorkspaceMembershipMessage);
      for (const document of getActiveMetaDocuments(server.hocuspocus).values()) {
        for (const connection of document.getConnections()) connection.sendStateless(message);
      }
      await Promise.all([
        publications.rebuildMetadata({ reconcileTitles: false }),
        revalidateActivePageConnections(server, pool, logger),
      ]);
    },
    onError: (error) => logger.error(`[listen] handleWorkspaceEvent failed: ${error}`),
  });

  let revalidationTask: Promise<unknown> | null = null;
  const revalidationTimer =
    permissionRevalidationMs > 0
      ? setInterval(() => {
          if (revalidationTask) return;
          revalidationTask = Promise.all([
            revalidateActivePageConnections(server, pool, logger),
            publications.rebuildMetadata({
              invalidateBacklinks: false,
              bumpAccessVersion: true,
              reconcileTitles: false,
            }),
          ])
            .catch((error) => {
              logger.error(
                `[reconcile] active access and metadata reconciliation failed: ${error}`,
              );
            })
            .finally(() => {
              revalidationTask = null;
            });
        }, permissionRevalidationMs)
      : null;
  revalidationTimer?.unref();

  let listenClient: Client | null = null;
  let connectingClient: Client | null = null;
  let listenConnectTask: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let stopped = false;
  const closingClients = new WeakSet<Client>();

  async function closeListenClient(client: Client, context: string): Promise<void> {
    if (closingClients.has(client)) return;
    closingClients.add(client);
    client.removeAllListeners();
    await client.end().catch((error: unknown) => {
      logger.error(`[listen] failed to close ${context} client: ${error}`);
    });
  }
  type DeletionEvent = { entityType: 'page' | 'folder'; entityId: string };
  const deletionEventQueue = createCoalescingTaskQueue<DeletionEvent>({
    maxPending: DELETION_EVENT_QUEUE_LIMIT,
    getKey: (event) => `${event.entityType}:${event.entityId}`,
    handle: (event) =>
      event.entityType === 'page'
        ? publications.pageDeleted(event.entityId)
        : publications.folderDeleted(event.entityId),
    handleOverflow: publications.reconcileDeletions,
    onError: (error) => logger.error(`[listen] deletion event failed: ${error}`),
  });
  const pageRenameEventQueue = createCoalescingTaskQueue<string>({
    maxPending: PAGE_RENAME_EVENT_QUEUE_LIMIT,
    getKey: (pageId) => pageId,
    handle: publications.pageRenamed,
    handleOverflow: () => publications.rebuildMetadata(),
    onError: (error) => logger.error(`[listen] handlePageRenamed failed: ${error}`),
  });
  const pageContentEventQueue = createCoalescingTaskQueue<string>({
    maxPending: PAGE_CONTENT_EVENT_QUEUE_LIMIT,
    getKey: (pageId) => pageId,
    handle: publications.pageContentReplaced,
    handleOverflow: publications.reconcileContent,
    onError: (error) => logger.error(`[listen] page content replacement failed: ${error}`),
  });

  function scheduleReconnect(): void {
    if (stopped || !databaseUrl) return;
    if (reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      startListenClient();
    }, delay);
  }

  async function connectListenClient(): Promise<void> {
    if (stopped || !databaseUrl) return;
    if (listenClient) {
      const staleClient = listenClient;
      listenClient = null;
      await closeListenClient(staleClient, 'stale');
    }
    if (stopped) return;

    let client: Client | null = null;
    try {
      client = createListenClient(databaseUrl);
      connectingClient = client;
      await client.connect();
      if (stopped) {
        if (connectingClient === client) connectingClient = null;
        await closeListenClient(client, 'connecting');
        return;
      }
      client.on('notification', (message) => {
        try {
          const payload = parseNotificationJson(message.payload);
          if (!payload) {
            logger.warn(`[listen] ignored malformed ${message.channel} notification`);
            return;
          }
          if (message.channel === 'page_deleted') {
            if (typeof payload.pageId === 'string') {
              deletionEventQueue.enqueue({ entityType: 'page', entityId: payload.pageId });
            }
          } else if (message.channel === 'folder_deleted') {
            if (typeof payload.folderId === 'string') {
              deletionEventQueue.enqueue({ entityType: 'folder', entityId: payload.folderId });
            }
          } else if (message.channel === 'page_renamed') {
            if (typeof payload.pageId === 'string') pageRenameEventQueue.enqueue(payload.pageId);
          } else if (message.channel === 'page_content_replaced') {
            if (typeof payload.pageId === 'string') pageContentEventQueue.enqueue(payload.pageId);
          } else if (message.channel === 'share_event') {
            const grant = parseGrantReceivedPayload(payload);
            if (grant) grantEventQueue.enqueue(grant);
            else {
              const shareEvent = parseShareEventPayload(payload);
              if (shareEvent) shareEventQueue.enqueue(shareEvent);
            }
          } else if (message.channel === 'workspace_event') {
            const workspaceEvent = parseWorkspaceEventPayload(payload);
            if (workspaceEvent) workspaceEventQueue.enqueue(workspaceEvent);
          }
        } catch (error) {
          logger.error(`[listen] failed to process notification: ${error}`);
        }
      });
      client.on('error', (error) => {
        logger.error(`[listen] client error: ${error.message}`);
        scheduleReconnect();
      });
      client.on('end', () => {
        logger.warn('[listen] client connection ended');
        scheduleReconnect();
      });
      await Promise.all([
        client.query('LISTEN page_content_replaced'),
        client.query('LISTEN page_renamed'),
        client.query('LISTEN page_deleted'),
        client.query('LISTEN folder_deleted'),
        client.query('LISTEN share_event'),
        client.query('LISTEN workspace_event'),
      ]);
      if (stopped) {
        if (connectingClient === client) connectingClient = null;
        await closeListenClient(client, 'connecting');
        return;
      }
      if (connectingClient === client) connectingClient = null;
      listenClient = client;
      // LISTEN starts before reconciliation, so replacements committed during
      // this pass are either observed here or delivered as a notification.
      // Run this on the initial subscription too: the server may already have
      // accepted editors while the listener was connecting.
      await Promise.all([publications.reconcileAll(), publications.reconcileContent()]);
      reconnectAttempts = 0;
      logger.info('[listen] subscribed and reconciled collaboration notification channels');
    } catch (error) {
      logger.error(`[listen] connection failed: ${error}`);
      if (listenClient === client) listenClient = null;
      if (connectingClient === client) connectingClient = null;
      if (client) {
        await closeListenClient(client, 'failed');
      }
      scheduleReconnect();
    }
  }

  function startListenClient(): void {
    if (stopped || !databaseUrl || listenConnectTask) return;
    const task = connectListenClient();
    listenConnectTask = task;
    void task.finally(() => {
      if (listenConnectTask === task) listenConnectTask = null;
    });
  }

  if (databaseUrl) startListenClient();
  else logger.warn('[listen] DATABASE_URL not configured — pg_notify subscriptions disabled');

  return async () => {
    stopped = true;
    if (revalidationTimer) clearInterval(revalidationTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    shareEventQueue.drainAndStop();
    grantEventQueue.drainAndStop();
    workspaceEventQueue.drainAndStop();
    deletionEventQueue.drainAndStop();
    pageContentEventQueue.drainAndStop();
    pageRenameEventQueue.drainAndStop();
    const client = listenClient;
    listenClient = null;
    const pendingClient = connectingClient;
    connectingClient = null;
    const pendingListenConnection = listenConnectTask;
    await Promise.all([
      client ? closeListenClient(client, 'active shutdown') : Promise.resolve(),
      pendingClient ? closeListenClient(pendingClient, 'connecting shutdown') : Promise.resolve(),
      shareEventQueue.waitForIdle(),
      grantEventQueue.waitForIdle(),
      workspaceEventQueue.waitForIdle(),
      deletionEventQueue.waitForIdle(),
      pageContentEventQueue.waitForIdle(),
      pageRenameEventQueue.waitForIdle(),
      revalidationTask ?? Promise.resolve(),
      pendingListenConnection ?? Promise.resolve(),
    ]);
  };
}
