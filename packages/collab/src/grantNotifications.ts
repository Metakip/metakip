import type { Document, Server } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import {
  type GrantReceivedMessage,
  getPageMetaRoomName,
  isPageMetaRoomName,
} from '@metakip/shared';
import type { Pool } from 'pg';
import { getSessionUser, isAnonymousSession, isCollabSession } from './collabSession';
import type { GrantReceivedPayload } from './notificationPayloads';

export function createGrantNotifier(server: Server, pool: Pool, logger: Logger) {
  return async function handleGrantReceived(payload: GrantReceivedPayload): Promise<void> {
    const canonicalGrant = await pool.query<{
      entity_title: string;
      shared_by_name: string;
    }>(
      `select case when s.entity_type = 'page' then p.title else f.name end as entity_title,
              coalesce(sharer.name, 'Someone') as shared_by_name
       from shares s
       join users sharer on sharer.id = s.shared_by
       left join pages p
         on s.entity_type = 'page' and p.id = s.entity_id and p.is_deleted = false
       left join folders f
         on s.entity_type = 'folder' and f.id = s.entity_id and f.is_deleted = false
       where s.entity_type = $1
         and s.entity_id = $2
         and s.recipient_user_id = $3
         and s.permission = $4
         and ((s.entity_type = 'page' and p.id is not null)
           or (s.entity_type = 'folder' and f.id is not null))
       limit 1`,
      [payload.entityType, payload.entityId, payload.targetUserId, payload.permission],
    );
    const grant = canonicalGrant.rows[0];
    if (!grant) {
      logger.debug(
        `[grant] stale grant ignored for user=${payload.targetUserId} entity=${payload.entityType}:${payload.entityId}`,
      );
      return;
    }

    const message = JSON.stringify({
      type: 'grant_received',
      entityType: payload.entityType,
      entityId: payload.entityId,
      entityTitle: grant.entity_title,
      sharedByName: grant.shared_by_name,
      ...(payload.message !== undefined && { message: payload.message }),
      refreshViaAccessVersion: true,
    } satisfies GrantReceivedMessage);
    let affectedCount = 0;
    const metaDocument = server.hocuspocus.documents.get(
      getPageMetaRoomName(payload.targetUserId),
    ) as Document | undefined;
    for (const connection of metaDocument?.getConnections() ?? []) {
      connection.sendStateless(message);
      affectedCount++;
    }

    if (affectedCount === 0) {
      for (const [documentName, document] of server.hocuspocus.documents) {
        if (isPageMetaRoomName(documentName)) continue;
        for (const connection of (document as Document).getConnections()) {
          const context = isCollabSession(connection.context) ? connection.context : undefined;
          if (
            !context?.principal ||
            isAnonymousSession(context) ||
            getSessionUser(context).id !== payload.targetUserId
          )
            continue;
          connection.sendStateless(message);
          affectedCount++;
        }
      }
    }

    logger.info(
      `[grant] sent grant_received to ${affectedCount} connection(s) for user=${payload.targetUserId}`,
    );
  };
}
