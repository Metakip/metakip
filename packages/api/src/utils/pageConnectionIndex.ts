import { extractIndexedPageConnections, type IndexedPageConnection } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor } from '../db/query';

export async function replacePageConnectionIndex(
  executor: QueryExecutor,
  pageId: string,
  ydoc: Uint8Array,
  properties: unknown,
): Promise<void> {
  await replacePageConnections(executor, pageId, extractIndexedPageConnections(ydoc, properties));
}

export async function replacePageTagConnectionIndex(
  executor: QueryExecutor,
  pageId: string,
  ydoc: Uint8Array | null,
  properties: unknown,
): Promise<void> {
  const tagConnections = extractIndexedPageConnections(ydoc ?? new Uint8Array(), properties).filter(
    (connection) => connection.connectionType === 'tag',
  );
  await executeQuery(
    executor,
    sql`select replace_page_connection_index(
      ${pageId},
      ${JSON.stringify(tagConnections)}::jsonb,
      array['tag']::text[]
    )`,
  );
}

export async function replacePageConnections(
  executor: QueryExecutor,
  pageId: string,
  connections: IndexedPageConnection[],
): Promise<void> {
  await executeQuery(
    executor,
    sql`select replace_page_connection_index(${pageId}, ${JSON.stringify(connections)}::jsonb)`,
  );
}
