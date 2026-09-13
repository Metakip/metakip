import type { Document, Server } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import type {
  ShareEventPayload,
  SharePermission,
  WorkspaceMembershipMessage,
} from '@metakip/shared';
import { COLLAB_TERMINAL_REASONS, getPageMetaRoomName, isPageMetaRoomName } from '@metakip/shared';
import type { Pool } from 'pg';
import {
  type CollabSession,
  getAuthenticatedCredential,
  getSessionUser,
  isAnonymousSession,
  isCollabSession,
} from './collabSession';
import { credentialStateKey, queryCredentialStates } from './credentialQueries';
import type { WorkspaceEventPayload } from './notificationPayloads';
import {
  type PrincipalPagePermissionCandidate,
  principalPagePermissionKey,
  queryPrincipalPagePermissions,
} from './permissionQueries';
import { applyPagePermissionTransition, applyPermissionSnapshot } from './permissionState';

type ConnectionContext = CollabSession;

type ActivePageCandidate = {
  pageId: string;
  connection: ReturnType<Document['getConnections']>[number];
  ctx: ConnectionContext;
  principal: PrincipalPagePermissionCandidate;
};

type PageRevalidationOptions = {
  logScope: 'share' | 'access';
  message?: string | undefined;
  advertisedAction?: ShareEventPayload['action'] | undefined;
  advertisedPermission?: SharePermission | undefined;
};

async function revalidatePageCandidates(
  pool: Pool,
  candidates: readonly ActivePageCandidate[],
  logger: Logger,
  options: PageRevalidationOptions,
): Promise<number> {
  if (candidates.length === 0) return 0;
  let permissionStates: Awaited<ReturnType<typeof queryPrincipalPagePermissions>>;
  try {
    permissionStates = await queryPrincipalPagePermissions(pool, [
      ...new Map(
        candidates.map(({ principal }) => [principalPagePermissionKey(principal), principal]),
      ).values(),
    ]);
  } catch (error) {
    for (const { pageId, connection, ctx } of candidates) {
      const user = getSessionUser(ctx);
      logger.error(
        `[${options.logScope}] failed to revalidate ${isAnonymousSession(ctx) ? 'anonymous' : 'user'}=${user.id} on page=${pageId}: ${error}`,
      );
      connection.close({
        code: 4500,
        reason: COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
      });
    }
    return candidates.length;
  }

  let affectedCount = 0;
  for (const { connection, ctx, principal } of candidates) {
    const state = permissionStates.get(principalPagePermissionKey(principal));
    if (!state) {
      connection.close({
        code: 4500,
        reason: COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
      });
      affectedCount++;
      continue;
    }
    const canonicalMessage =
      options.message === undefined || options.advertisedAction === undefined
        ? options.message
        : state.permission === null
          ? options.advertisedAction === 'revoke'
            ? options.message
            : undefined
          : (options.advertisedAction === 'grant' || options.advertisedAction === 'update') &&
              options.advertisedPermission === state.permission
            ? options.message
            : undefined;
    const transition = applyPagePermissionTransition(connection, ctx, state, canonicalMessage);
    if (transition === 'ignored') continue;
    if (transition === 'unchanged') {
      if (canonicalMessage !== undefined) affectedCount++;
      continue;
    }
    affectedCount++;
  }
  return affectedCount;
}

function bumpShareAccessMetaVersion(server: Server, userIds: Iterable<string>): void {
  for (const userId of new Set(userIds)) {
    const metaDocument = server.hocuspocus?.documents?.get(getPageMetaRoomName(userId)) as
      | Document
      | undefined;
    if (!metaDocument) continue;
    metaDocument.transact(() => {
      const versions = metaDocument.getMap<number>('accessVersion');
      versions.set('access', (versions.get('access') ?? 0) + 1);
    });
  }
}

function sendWorkspaceMembershipCompatibilityEvent(
  server: Server,
  userIds: Iterable<string>,
  event: Pick<WorkspaceEventPayload, 'action' | 'ownerId'>,
): void {
  const message = JSON.stringify({
    type: 'workspace_membership_event',
    action: event.action,
    ownerId: event.ownerId,
    // Older clients use this stateless event. New clients rely on the durable
    // accessVersion update and skip the duplicate query invalidation.
    refreshViaAccessVersion: true,
  } satisfies WorkspaceMembershipMessage);
  for (const userId of new Set(userIds)) {
    const metaDocument = server.hocuspocus?.documents?.get(getPageMetaRoomName(userId)) as
      | Document
      | undefined;
    for (const connection of metaDocument?.getConnections() ?? []) {
      connection.sendStateless(message);
    }
  }
}

/**
 * Recompute every active connection's effective permission from the database.
 * Used for inheritance-policy changes where affected users are not known ahead
 * of time and permissions may be revoked, downgraded, or upgraded indirectly.
 */
async function recomputePageConnections(
  server: Server,
  pageIds: readonly string[],
  pool: Pool,
  logger: Logger,
  message?: string,
  targetUserId?: string,
  metaUserIds?: Set<string>,
  advertisedAction?: ShareEventPayload['action'],
  advertisedPermission?: SharePermission,
): Promise<number> {
  const candidates: ActivePageCandidate[] = [];
  for (const pageId of new Set(pageIds)) {
    const activeDoc = server.hocuspocus?.documents?.get(pageId) as Document | undefined;
    if (!activeDoc) {
      logger.debug(`[share] no active document for page ${pageId}, skipping`);
      continue;
    }
    for (const connection of activeDoc.getConnections()) {
      const ctx = isCollabSession(connection.context) ? connection.context : undefined;
      if (!ctx) {
        logger.debug('[share] connection has no user context, skipping');
        continue;
      }
      const user = getSessionUser(ctx);
      // Anonymous IDs are client supplied and must never satisfy a delivery
      // filter intended for a signed-in account.
      if (targetUserId !== undefined && (isAnonymousSession(ctx) || user.id !== targetUserId))
        continue;
      const principal: PrincipalPagePermissionCandidate = isAnonymousSession(ctx)
        ? { kind: 'anonymous', pageId }
        : { kind: 'account', pageId, userId: user.id };
      candidates.push({ pageId, connection, ctx, principal });
    }
  }
  if (candidates.length === 0) return 0;

  const authenticatedUserIds = candidates.flatMap(({ ctx }) =>
    isAnonymousSession(ctx) ? [] : [getSessionUser(ctx).id],
  );
  if (metaUserIds) {
    for (const userId of authenticatedUserIds) metaUserIds.add(userId);
  } else {
    bumpShareAccessMetaVersion(server, authenticatedUserIds);
  }
  return revalidatePageCandidates(pool, candidates, logger, {
    logScope: 'share',
    message,
    advertisedAction,
    advertisedPermission,
  });
}

const PAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Periodically revalidate active page rooms as a fail-safe for missed access
 * notifications and login-session expiry. Requests are batched independently
 * of the number of open sockets.
 */
export async function revalidateActivePageConnections(
  server: Server,
  pool: Pool,
  logger: Logger,
): Promise<number> {
  const pageCandidates: Array<{
    pageId: string;
    connection: ReturnType<Document['getConnections']>[number];
    ctx: ConnectionContext;
    principal: PrincipalPagePermissionCandidate;
  }> = [];
  const metaCandidates: Array<{
    connection: ReturnType<Document['getConnections']>[number];
    ctx: ConnectionContext;
  }> = [];

  for (const [documentName, document] of server.hocuspocus?.documents ?? []) {
    for (const connection of (document as Document).getConnections()) {
      const ctx = isCollabSession(connection.context) ? connection.context : undefined;
      if (!ctx) continue;
      if (PAGE_ID_PATTERN.test(documentName)) {
        const user = getSessionUser(ctx);
        if (isAnonymousSession(ctx)) {
          pageCandidates.push({
            pageId: documentName,
            connection,
            ctx,
            principal: { kind: 'anonymous', pageId: documentName },
          });
        } else {
          pageCandidates.push({
            pageId: documentName,
            connection,
            ctx,
            principal: {
              kind: 'authenticated',
              pageId: documentName,
              userId: user.id,
              credential: getAuthenticatedCredential(ctx),
            },
          });
        }
      } else if (isPageMetaRoomName(documentName) && !isAnonymousSession(ctx)) {
        metaCandidates.push({ connection, ctx });
      }
    }
  }
  if (pageCandidates.length === 0 && metaCandidates.length === 0) return 0;

  const metaCredentials = new Map<
    string,
    { userId: string; credential: ReturnType<typeof getAuthenticatedCredential> }
  >();
  for (const { ctx } of metaCandidates) {
    const userId = getSessionUser(ctx).id;
    const credential = getAuthenticatedCredential(ctx);
    metaCredentials.set(`${userId}:${credential.kind}:${credential.raw}`, { userId, credential });
  }
  const credentialRequests = Array.from(metaCredentials.values());
  const [pageResult, metaSessionResult] = await Promise.allSettled([
    revalidatePageCandidates(pool, pageCandidates, logger, {
      logScope: 'access',
    }),
    queryCredentialStates(pool, credentialRequests),
  ]);
  let affectedCount = pageResult.status === 'fulfilled' ? pageResult.value : 0;
  if (pageResult.status === 'rejected') {
    logger.error(`[access] active page revalidation failed: ${pageResult.reason}`);
    for (const { connection } of pageCandidates) {
      connection.close({
        code: 4500,
        reason: COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
      });
      affectedCount++;
    }
  }

  for (const { connection, ctx } of metaCandidates) {
    const userId = getSessionUser(ctx).id;
    if (metaSessionResult.status === 'rejected') {
      logger.error(`[access] failed to revalidate metadata session for user=${userId}`);
      connection.close({
        code: 4500,
        reason: COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
      });
      affectedCount++;
      continue;
    }
    const sessionState = metaSessionResult.value.get(
      credentialStateKey({ userId, credential: getAuthenticatedCredential(ctx) }),
    );
    if (!sessionState) {
      connection.close({
        code: 4500,
        reason: COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
      });
      affectedCount++;
      continue;
    }
    applyPermissionSnapshot(connection, ctx, {
      permission: null,
      accessRevision: sessionState.accessRevision,
    });
    if (sessionState.valid) continue;
    connection.close({ code: 4401, reason: COLLAB_TERMINAL_REASONS.SESSION_EXPIRED });
    affectedCount++;
  }

  return affectedCount;
}

/**
 * Handle a share event from pg_notify. Finds all active WebSocket connections
 * to the affected document(s) and applies the permission change in realtime:
 *
 * - `entityType = 'page'`: applies to the single page document
 * - `entityType = 'folder'`: applies to all pages in the folder and its descendants
 *
 * Connection matching:
 * - `targetUserId = undefined` → affects public-access connections
 * - `targetUserId = string`    → affects that specific account grant
 */
export async function handleShareEvent(
  server: Server,
  payload: ShareEventPayload,
  pool: Pool,
  logger: Logger,
): Promise<void> {
  const {
    entityType,
    entityId,
    action,
    permission: rawPermission,
    targetUserId,
    message,
  } = payload;

  logger.debug(
    `[share] received event: action=${action} entityType=${entityType} entity=${entityId} permission=${rawPermission ?? 'none'} targetUserId=${targetUserId ?? 'all'}`,
  );

  const metaUserIds = new Set(payload.metaUserIds ?? []);
  if (targetUserId) metaUserIds.add(targetUserId);

  if (payload.metaOnly === true) {
    // Public-access visits change dashboard/list visibility, but they do not
    // change any already-open page connection's effective permission. Keep
    // this notification targeted and bounded: only invalidate the named
    // users' durable meta rooms, without folder fanout or page revalidation.
    bumpShareAccessMetaVersion(server, metaUserIds);
    logger.debug(
      `[share] processed metadata-only invalidation for ${entityType} ${entityId}: ${metaUserIds.size} user(s)`,
    );
    return;
  }

  try {
    // For folders, intersect the subtree with active page rooms before doing
    // any permission work. Inactive pages rebuild authorization from PostgreSQL
    // when they are opened and must not block live revocations.
    if (entityType === 'folder') {
      const activePageIds = Array.from(server.hocuspocus?.documents?.keys() ?? []).filter(
        (pageId) => PAGE_ID_PATTERN.test(pageId),
      );
      if (activePageIds.length === 0) {
        logger.debug(`[share] no active pages for folder ${entityId}, skipping`);
        return;
      }

      let pageIds: string[] = [];
      try {
        const result = await pool.query(
          `SELECT p.id FROM pages p
          WHERE p.id = ANY($2::uuid[])
            AND p.parent_id IN (
              SELECT descendant_id FROM folder_closure WHERE ancestor_id = $1
            )
            AND p.is_deleted = false`,
          [entityId, activePageIds],
        );
        pageIds = result.rows.map((r: { id: string }) => r.id);
      } catch (err) {
        logger.error(`[share] failed to query pages in folder ${entityId}: ${err}`);
        // The subtree lookup failed, so revalidate matching users on every
        // active page. The batched canonical query still fails closed.
        await recomputePageConnections(
          server,
          activePageIds,
          pool,
          logger,
          message,
          targetUserId,
          metaUserIds,
          action,
          rawPermission,
        );
        return;
      }

      if (pageIds.length === 0) {
        logger.debug(`[share] no active pages found in folder ${entityId}, skipping`);
        return;
      }

      logger.debug(`[share] folder ${entityId} has ${pageIds.length} page(s), propagating to each`);

      const totalAffected = await recomputePageConnections(
        server,
        pageIds,
        pool,
        logger,
        message,
        targetUserId,
        metaUserIds,
        action,
        rawPermission,
      );

      logger.info(
        `[share] processed ${action} for folder ${entityId}: ${pageIds.length} page(s), ${totalAffected} connection(s) affected`,
      );
      return;
    }

    const affectedCount = await recomputePageConnections(
      server,
      [entityId],
      pool,
      logger,
      message,
      targetUserId,
      metaUserIds,
      action,
      rawPermission,
    );
    logger.info(
      `[share] processed recompute for page ${entityId}: ${affectedCount} connection(s) affected`,
    );
  } finally {
    bumpShareAccessMetaVersion(server, metaUserIds);
  }
}

export async function handleWorkspaceEvent(
  server: Server,
  payload: WorkspaceEventPayload,
  pool: Pool,
  logger: Logger,
): Promise<void> {
  const { action, ownerId, memberId, message } = payload;

  logger.debug(`[workspace] received event: action=${action} owner=${ownerId} member=${memberId}`);

  const metaUserIds = new Set([ownerId, memberId]);

  try {
    const activePageIds = Array.from(server.hocuspocus?.documents?.keys() ?? []).filter(
      (documentName) => !isPageMetaRoomName(documentName),
    );
    if (activePageIds.length === 0) {
      logger.debug(`[workspace] no active pages for workspace owner ${ownerId}, skipping`);
      return;
    }

    let pageIds: string[] = [];
    try {
      const result = await pool.query<{ id: string }>(
        `SELECT p.id
       FROM pages p
       WHERE p.id = ANY($2::uuid[])
         AND p.is_deleted = false
         AND COALESCE(get_root_folder_owner(p.parent_id), p.created_by) = $1`,
        [ownerId, activePageIds],
      );
      pageIds = result.rows.map((row) => row.id);
    } catch (err) {
      logger.error(
        `[workspace] failed to query active pages for workspace owner ${ownerId}: ${err}`,
      );
      // The workspace could not be identified, so revalidate only this member
      // on active pages. Each recomputation remains fail closed.
      await recomputePageConnections(
        server,
        activePageIds,
        pool,
        logger,
        message,
        memberId,
        metaUserIds,
      );
      return;
    }

    if (pageIds.length === 0) {
      logger.debug(`[workspace] no matching active pages for workspace owner ${ownerId}, skipping`);
      return;
    }

    await recomputePageConnections(server, pageIds, pool, logger, message, memberId, metaUserIds);
  } finally {
    bumpShareAccessMetaVersion(server, metaUserIds);
    sendWorkspaceMembershipCompatibilityEvent(server, metaUserIds, { action, ownerId });
  }
}
