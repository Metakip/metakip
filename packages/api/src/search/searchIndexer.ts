import { getApiLogger } from '@metakip/shared';
import { yDocToSearchText } from '@metakip/shared/yjs-helpers';
import { sql } from 'drizzle-orm';
import type { QueryResultRow } from 'pg';
import { db } from '../db/connection';
import { executeQuery, query } from '../db/query';
import {
  createMeilisearchClient,
  PAGE_SEARCH_INDEX,
  type SearchDocument,
  searchDocumentId,
} from './meilisearch';

const INDEX_BATCH_SIZE = 20;
const INDEX_INTERVAL_MS = 2_000;

type QueuedPage = QueryResultRow & { page_id: string; requested_at: Date };
type PageForIndex = QueryResultRow & {
  id: string;
  title: string;
  ydoc: Buffer | null;
  is_deleted: boolean | null;
  access_tokens: string[];
};
type QueuedFolder = QueryResultRow & { folder_id: string; requested_at: Date };
type FolderForIndex = QueryResultRow & {
  id: string;
  name: string;
  is_deleted: boolean | null;
  access_tokens: string[];
};

/** Enqueue a full rebuild exactly once per Meilisearch index generation. */
export async function ensureSearchIndexGeneration(generation: string): Promise<void> {
  await db.transaction(async (tx) => {
    const changed = await executeQuery(
      tx,
      sql`
        insert into search_index_state (index_uid, generation)
        values (${PAGE_SEARCH_INDEX}, ${generation})
        on conflict (index_uid) do update set generation = excluded.generation
        where search_index_state.generation is distinct from excluded.generation
        returning index_uid
      `,
    );
    if (changed.rowCount === 0) return;

    await executeQuery(
      tx,
      sql`
        insert into search_index_queue (page_id, requested_at)
        select id, clock_timestamp() from pages where true
        on conflict (page_id) do update
        set requested_at = greatest(excluded.requested_at, search_index_queue.requested_at + interval '1 millisecond')
      `,
    );
    await executeQuery(
      tx,
      sql`
        insert into folder_search_index_queue (folder_id, requested_at)
        select id, clock_timestamp() from folders where true
        on conflict (folder_id) do update
        set requested_at = greatest(excluded.requested_at, folder_search_index_queue.requested_at + interval '1 millisecond')
      `,
    );
  });
}

export async function drainPageSearchIndexQueue(): Promise<void> {
  const client = createMeilisearchClient();
  if (!client) return;

  const queueResult = await query(sql`
    select page_id, requested_at
    from search_index_queue
    order by requested_at, page_id
    limit ${INDEX_BATCH_SIZE}
  `);
  const queued = queueResult.rows as QueuedPage[];
  if (queued.length === 0) return;

  const pageIds = queued.map((row) => row.page_id);
  const pagesResult = await query(sql`
    select page.id, page.title, page.ydoc, page.is_deleted, projection.access_tokens
    from pages page
    cross join lateral (
      select coalesce(array_agg(distinct access.access_token), '{}'::text[]) as access_tokens
      from get_page_search_access_tokens(page.id) access
    ) projection
    where page.id = any(${sql.param(pageIds)}::uuid[])
  `);
  const pages = pagesResult.rows as PageForIndex[];
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const documents: SearchDocument[] = [];
  const deletedIds: string[] = [];

  for (const item of queued) {
    const page = pagesById.get(item.page_id);
    if (!page || page.is_deleted) {
      deletedIds.push(searchDocumentId('page', item.page_id));
      continue;
    }

    let content = '';
    if (page.ydoc && page.ydoc.length > 0) {
      try {
        content = yDocToSearchText(new Uint8Array(page.ydoc));
      } catch (error) {
        getApiLogger().warn('Could not extract page text for search indexing', {
          pageId: page.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    documents.push({
      id: searchDocumentId('page', page.id),
      type: 'page',
      entityId: page.id,
      title: page.title,
      content,
      accessTokens: page.access_tokens,
    });
  }

  await client.upsertDocuments(documents);
  await client.deleteDocuments(deletedIds);

  const processedRows = sql.join(
    queued.map((item) => sql`(${item.page_id}::uuid, ${item.requested_at}::timestamptz)`),
    sql`, `,
  );
  await query(sql`
    delete from search_index_queue queued
    using (values ${processedRows}) as processed(page_id, requested_at)
    where queued.page_id = processed.page_id
      and queued.requested_at = processed.requested_at
  `);
}

export async function drainFolderSearchIndexQueue(): Promise<void> {
  const client = createMeilisearchClient();
  if (!client) return;

  const queueResult = await query(sql`
    select folder_id, requested_at
    from folder_search_index_queue
    order by requested_at, folder_id
    limit ${INDEX_BATCH_SIZE}
  `);
  const queued = queueResult.rows as QueuedFolder[];
  if (queued.length === 0) return;

  const folderIds = queued.map((row) => row.folder_id);
  const foldersResult = await query(sql`
    select folder.id, folder.name, folder.is_deleted, projection.access_tokens
    from folders folder
    cross join lateral (
      select coalesce(array_agg(distinct access.access_token), '{}'::text[]) as access_tokens
      from get_folder_search_access_tokens(folder.id) access
    ) projection
    where folder.id = any(${sql.param(folderIds)}::uuid[])
  `);
  const folders = foldersResult.rows as FolderForIndex[];
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const documents: SearchDocument[] = [];
  const deletedIds: string[] = [];

  for (const item of queued) {
    const folder = foldersById.get(item.folder_id);
    if (!folder || folder.is_deleted) {
      deletedIds.push(searchDocumentId('folder', item.folder_id));
      continue;
    }
    documents.push({
      id: searchDocumentId('folder', folder.id),
      type: 'folder',
      entityId: folder.id,
      title: folder.name,
      content: '',
      accessTokens: folder.access_tokens,
    });
  }

  await client.upsertDocuments(documents);
  await client.deleteDocuments(deletedIds);

  const processedRows = sql.join(
    queued.map((item) => sql`(${item.folder_id}::uuid, ${item.requested_at}::timestamptz)`),
    sql`, `,
  );
  await query(sql`
    delete from folder_search_index_queue queued
    using (values ${processedRows}) as processed(folder_id, requested_at)
    where queued.folder_id = processed.folder_id
      and queued.requested_at = processed.requested_at
  `);
}

export function startSearchIndexWorker(): void {
  const client = createMeilisearchClient();
  if (!client) return;

  let isRunning = false;
  const run = async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const generation = await client.ensurePageIndex();
      await ensureSearchIndexGeneration(generation);
      await Promise.all([
        drainPageSearchIndexQueue().catch((error: unknown) => {
          getApiLogger().error('Meilisearch page indexing failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }),
        drainFolderSearchIndexQueue().catch((error: unknown) => {
          getApiLogger().error('Meilisearch folder indexing failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }),
      ]);
    } catch (error) {
      getApiLogger().error('Meilisearch index initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      isRunning = false;
    }
  };

  const timer = setInterval(() => void run(), INDEX_INTERVAL_MS);
  timer.unref();
  void run();
}
