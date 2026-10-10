import type { PublicPermission, ShareEntityType, SharePermission } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor, query } from '../db/query';
import { notifyShareRecompute } from './share-notify';

export type { PublicPermission } from '@metakip/shared';
export type PublicAccessEntityType = ShareEntityType;
export type ResolvedEntityAccess = {
  accountPermission: SharePermission | null;
  publicPermission: PublicPermission | null;
  permission: SharePermission | null;
  fullAccess: boolean;
};

export async function getPublicPermission(
  entityType: PublicAccessEntityType,
  entityId: string,
  executor?: QueryExecutor,
): Promise<PublicPermission | null> {
  const statement =
    entityType === 'page'
      ? sql`select get_public_page_permission(${entityId}) as permission`
      : sql`select get_public_folder_permission(${entityId}) as permission`;
  const result = executor
    ? await executeQuery<{ permission: PublicPermission | null }>(executor, statement)
    : await query<{ permission: PublicPermission | null }>(statement);
  return result.rows[0]?.permission ?? null;
}

export async function resolveEntityAccess(
  entityType: PublicAccessEntityType,
  entityId: string,
  userId: string,
  executor: QueryExecutor,
): Promise<ResolvedEntityAccess> {
  const statement =
    entityType === 'page'
      ? sql`select * from get_page_access_snapshot(${entityId}, ${userId})`
      : sql`select * from get_folder_access_snapshot(${entityId}, ${userId})`;
  const result = await executeQuery<{
    account_permission: ResolvedEntityAccess['accountPermission'];
    public_permission: PublicPermission | null;
    permission: ResolvedEntityAccess['permission'];
    full_access: boolean;
  }>(executor, statement);
  const row = result.rows[0];
  return {
    accountPermission: row?.account_permission ?? null,
    publicPermission: row?.public_permission ?? null,
    permission: row?.permission ?? null,
    fullAccess: row?.full_access === true,
  };
}

export async function recordPublicVisit(
  executor: QueryExecutor,
  entityType: PublicAccessEntityType,
  entityId: string,
  userId: string,
): Promise<boolean> {
  const result =
    entityType === 'page'
      ? await executeQuery(
          executor,
          sql`insert into page_public_access_visits (page_id, user_id, first_seen_at, last_seen_at)
           values (${entityId}, ${userId}, now(), now())
           on conflict (page_id, user_id)
           do update set last_seen_at = excluded.last_seen_at
           returning (xmax = 0) as inserted`,
        )
      : await executeQuery(
          executor,
          sql`insert into folder_public_access_visits (folder_id, user_id, first_seen_at, last_seen_at)
           values (${entityId}, ${userId}, now(), now())
           on conflict (folder_id, user_id)
           do update set last_seen_at = excluded.last_seen_at
           returning (xmax = 0) as inserted`,
        );
  return result.rows[0]?.inserted === true;
}

/**
 * A first public visit changes the visitor's navigation metadata. Publish the
 * matching targeted refresh in the same transaction that records the visit.
 */
export async function recordPublicVisitAndNotify(
  executor: QueryExecutor,
  entityType: PublicAccessEntityType,
  entityId: string,
  userId: string,
): Promise<boolean> {
  const inserted = await recordPublicVisit(executor, entityType, entityId, userId);
  if (!inserted) return false;
  await notifyShareRecompute(
    {
      entityType,
      entityId,
      targetUserId: userId,
      metaUserIds: [userId],
      metaOnly: true,
    },
    executor,
  );
  return true;
}
