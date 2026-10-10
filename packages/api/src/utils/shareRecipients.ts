import type { ShareEntityType } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor } from '../db/query';

/**
 * Return signed-in accounts whose access or navigation can be affected by an
 * entity mutation. Returning a conservative superset is intentional: metadata
 * invalidation may be redundant, but must never miss an affected account.
 */
export async function getEntityMetaUserIds(
  executor: QueryExecutor,
  entityType: ShareEntityType,
  entityId: string,
): Promise<string[]> {
  const statement =
    entityType === 'page'
      ? sql`with target as (
           select page.parent_id,
                  coalesce(get_root_folder_owner(page.parent_id), page.created_by) as owner_id
           from pages page
           where page.id = ${entityId}
         ), source_folders as (
           select path.ancestor_id as id
           from target
           join folder_closure path on path.descendant_id = target.parent_id
         ), candidates as (
           select owner_id as user_id from target
           union
           select member.member_id from target
           join workspace_members member on member.workspace_owner_id = target.owner_id
           union
           select share.recipient_user_id from shares share
           where share.entity_type = 'page' and share.entity_id = ${entityId}
           union
           select share.recipient_user_id from shares share
           where share.entity_type = 'folder'
             and share.entity_id in (select id from source_folders)
           union
           select visit.user_id from page_public_access_visits visit where visit.page_id = ${entityId}
           union
           select visit.user_id from folder_public_access_visits visit
           where visit.folder_id in (select id from source_folders)
         )
         select distinct user_id from candidates where user_id is not null`
      : sql`with target_folders as (
           select path.descendant_id as id
           from folder_closure path
           where path.ancestor_id = ${entityId}
         ), target_pages as (
           select page.id from pages page
           where page.parent_id in (select id from target_folders)
         ), related_folders as (
           select path.ancestor_id as id
           from folder_closure path
           where path.descendant_id = ${entityId}
           union
           select id from target_folders
         ), target as (
           select get_root_folder_owner(${entityId}) as owner_id
         ), candidates as (
           select owner_id as user_id from target
           union
           select member.member_id from target
           join workspace_members member on member.workspace_owner_id = target.owner_id
           union
           select share.recipient_user_id from shares share
           where share.entity_type = 'folder'
             and share.entity_id in (select id from related_folders)
           union
           select share.recipient_user_id from shares share
           where share.entity_type = 'page'
             and share.entity_id in (select id from target_pages)
           union
           select visit.user_id from folder_public_access_visits visit
           where visit.folder_id in (select id from related_folders)
           union
           select visit.user_id from page_public_access_visits visit
           where visit.page_id in (select id from target_pages)
         )
         select distinct user_id from candidates where user_id is not null`;

  const result = await executeQuery<{ user_id: string }>(executor, statement);
  return result.rows.map((row) => row.user_id);
}

export function mergeMetaUserIds(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat())];
}
