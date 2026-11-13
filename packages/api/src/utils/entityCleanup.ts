import { sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor } from '../db/query';

type EntityType = 'folder' | 'page';

/**
 * Remove records whose polymorphic entity reference cannot be protected by a
 * database foreign key. Entity-specific public visit history is deleted
 * explicitly as well so a purge has one auditable cleanup path instead of a
 * mix of manual deletes and cascades.
 */
export async function purgeEntityAccessMetadata(
  executor: QueryExecutor,
  entityType: EntityType,
  entityIds: readonly string[],
): Promise<void> {
  if (entityIds.length === 0) return;

  await executeQuery(
    executor,
    sql`delete from shares where entity_type = ${entityType} and entity_id = any(${sql.param([...entityIds])}::uuid[])`,
  );
  await executeQuery(
    executor,
    sql`delete from user_stars where entity_type = ${entityType} and entity_id = any(${sql.param([...entityIds])}::uuid[])`,
  );

  if (entityType === 'page') {
    await executeQuery(
      executor,
      sql`delete from page_public_access_visits where page_id = any(${sql.param([...entityIds])}::uuid[])`,
    );
    return;
  }

  await executeQuery(
    executor,
    sql`delete from folder_public_access_visits where folder_id = any(${sql.param([...entityIds])}::uuid[])`,
  );
}
