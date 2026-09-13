import type { Document, Hocuspocus } from '@hocuspocus/server';
import { MAX_WIKI_LINK_PRESENTATION_REQUESTS } from '@metakip/shared';
import type { PoolClient } from 'pg';
import { getSessionUser, isAnonymousSession, isCollabSession } from './collabSession';
import { isUuid } from './utils';

type QueryExecutor = Pick<PoolClient, 'query'>;

type WikiLinkInvalidationScope =
  | { targetPageIds: readonly string[] }
  | { folderId: string }
  | { workspaceOwnerId: string };

/** Notify only active source documents whose persisted links hit the affected targets. */
export async function broadcastWikiLinkPresentationInvalidation(
  hocuspocus: Hocuspocus,
  executor: QueryExecutor,
  scope: WikiLinkInvalidationScope,
  options: { recipientUserId?: string } = {},
): Promise<number> {
  const activeSourceIds = Array.from(hocuspocus.documents.keys()).filter(isUuid);
  if (activeSourceIds.length === 0) return 0;

  const targetPageIds =
    'targetPageIds' in scope ? [...new Set(scope.targetPageIds.filter(isUuid))] : null;
  if (targetPageIds?.length === 0) return 0;

  const result = await executor.query<{ source_id: string; target_id: string }>(
    `select distinct connection.source_id, connection.target_id
     from connections connection
     left join pages target on target.id = connection.target_id
     where connection.source_type = 'page'
       and connection.target_type = 'page'
       and connection.target_id is not null
       and connection.source_id = any($1::uuid[])
       and (
         ($2::uuid[] is not null and connection.target_id = any($2::uuid[]))
         or (
           $3::uuid is not null
           and target.parent_id is not null
           and (
             target.parent_id = $3::uuid
             or exists (
               select 1 from folder_closure path
               where path.ancestor_id = $3::uuid
                 and path.descendant_id = target.parent_id
             )
           )
         )
         or (
           $4::uuid is not null
           and coalesce(get_root_folder_owner(target.parent_id), target.created_by) = $4::uuid
         )
       )
     order by connection.source_id, connection.target_id`,
    [
      activeSourceIds,
      targetPageIds,
      'folderId' in scope ? scope.folderId : null,
      'workspaceOwnerId' in scope ? scope.workspaceOwnerId : null,
    ],
  );

  const targetIdsBySource = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const targetIds = targetIdsBySource.get(row.source_id) ?? new Set<string>();
    targetIds.add(row.target_id);
    targetIdsBySource.set(row.source_id, targetIds);
  }

  let notifiedConnectionCount = 0;
  for (const [sourceId, targetIds] of targetIdsBySource) {
    const document = hocuspocus.documents.get(sourceId) as Document | undefined;
    if (!document) continue;
    const ids = [...targetIds];
    for (let offset = 0; offset < ids.length; offset += MAX_WIKI_LINK_PRESENTATION_REQUESTS) {
      const message = JSON.stringify({
        type: 'wiki_link_presentations_changed',
        targetIds: ids.slice(offset, offset + MAX_WIKI_LINK_PRESENTATION_REQUESTS),
      });
      for (const connection of document.getConnections()) {
        if (options.recipientUserId) {
          const session = isCollabSession(connection.context) ? connection.context : undefined;
          if (
            !session ||
            isAnonymousSession(session) ||
            getSessionUser(session).id !== options.recipientUserId
          )
            continue;
        }
        connection.sendStateless(message);
        notifiedConnectionCount += 1;
      }
    }
  }
  return notifiedConnectionCount;
}
