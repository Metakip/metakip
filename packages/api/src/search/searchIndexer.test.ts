import { markdownToYjsState } from '@metakip/shared/markdown-yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import { createTestFolder, createTestPage, createTestUser } from '../test-utils';
import { createMeilisearchClient, searchDocumentId } from './meilisearch';
import {
  drainFolderSearchIndexQueue,
  drainPageSearchIndexQueue,
  ensureSearchIndexGeneration,
} from './searchIndexer';

describe('page search index worker', () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.MEILISEARCH_URL;
  const previousKey = process.env.MEILI_MASTER_KEY;
  const indexedDocuments: Array<{
    id: string;
    type: 'page' | 'folder';
    entityId: string;
    title: string;
    content: string;
    accessTokens: string[];
  }> = [];
  const deletedBatches: string[][] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.MEILISEARCH_URL;
    else process.env.MEILISEARCH_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEILI_MASTER_KEY;
    else process.env.MEILI_MASTER_KEY = previousKey;
    indexedDocuments.length = 0;
    deletedBatches.length = 0;
  });

  it('requeues existing documents once when the index generation changes', async () => {
    const user = await createTestUser();
    const page = await createTestPage(user.id, { title: 'Recovery target' });
    const folder = await createTestFolder(user.id, { name: 'Recovery folder' });
    await query('delete from search_index_queue where page_id = $1', [page.id]);
    await query('delete from folder_search_index_queue where folder_id = $1', [folder.id]);

    const generation = `recovery-${page.id}`;
    await ensureSearchIndexGeneration(generation);
    expect(
      (await query('select page_id from search_index_queue where page_id = $1', [page.id])).rows,
    ).toHaveLength(1);
    expect(
      (
        await query('select folder_id from folder_search_index_queue where folder_id = $1', [
          folder.id,
        ])
      ).rows,
    ).toHaveLength(1);

    await query('delete from search_index_queue where page_id = $1', [page.id]);
    await ensureSearchIndexGeneration(generation);
    expect(
      (await query('select page_id from search_index_queue where page_id = $1', [page.id])).rows,
    ).toHaveLength(0);
  });

  it('enqueues overlapping folder subtrees only once per bulk ACL change', async () => {
    const user = await createTestUser();
    const root = await createTestFolder(user.id, { name: 'Root' });
    const child = await createTestFolder(user.id, { name: 'Child', parentId: root.id });
    const leaf = await createTestFolder(user.id, { name: 'Leaf', parentId: child.id });
    const page = await createTestPage(user.id, { parentId: leaf.id });
    const marker = new Date('2100-01-01T00:00:00.000Z');
    await query('update search_index_queue set requested_at = $1 where page_id = $2', [
      marker,
      page.id,
    ]);
    await query('update folder_search_index_queue set requested_at = $1 where folder_id = $2', [
      marker,
      leaf.id,
    ]);

    await query('update folders set name = $1 where id = $2', ['Renamed root', root.id]);
    const afterRename = await query<{ requested_at: Date }>(
      'select requested_at from search_index_queue where page_id = $1',
      [page.id],
    );
    expect(afterRename.rows[0]?.requested_at).toEqual(marker);

    await query('update folders set public_permission = $1 where id = any($2::uuid[])', [
      'view',
      [root.id, child.id, leaf.id],
    ]);
    const pageQueue = await query<{ requested_at: Date }>(
      'select requested_at from search_index_queue where page_id = $1',
      [page.id],
    );
    const folderQueue = await query<{ requested_at: Date }>(
      'select requested_at from folder_search_index_queue where folder_id = $1',
      [leaf.id],
    );
    expect(pageQueue.rows[0]?.requested_at).toEqual(new Date(marker.getTime() + 1));
    // The leaf's own row update queues it once; the subtree update adds it once more.
    expect(folderQueue.rows[0]?.requested_at).toEqual(new Date(marker.getTime() + 2));
  });

  it('keeps explicit grants searchable without rewriting a workspace on member removal', async () => {
    const owner = await createTestUser();
    const member = await createTestUser();
    const page = await createTestPage(owner.id, { title: 'Directly shared' });
    await query(
      `insert into workspace_members (workspace_owner_id, member_id, role)
       values ($1, $2, 'viewer')`,
      [owner.id, member.id],
    );
    await query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'view')`,
      [page.id, owner.id, member.id],
    );
    const tokens = await query<{ access_token: string }>(
      'select access_token from get_page_search_access_tokens($1)',
      [page.id],
    );
    expect(tokens.rows.map((row) => row.access_token)).toContain(`user:${member.id}`);

    await query('delete from search_index_queue where page_id = $1', [page.id]);
    await query('delete from workspace_members where workspace_owner_id = $1 and member_id = $2', [
      owner.id,
      member.id,
    ]);
    expect(
      (await query('select page_id from search_index_queue where page_id = $1', [page.id])).rows,
    ).toHaveLength(0);
  });

  it('indexes page body text and removes soft-deleted pages from Meilisearch', async () => {
    const user = await createTestUser();
    const recipient = await createTestUser();
    const page = await createTestPage(user.id, { title: 'Indexing target' });
    const folder = await createTestFolder(user.id, { name: 'Searchable folder' });
    const inheritedPage = await createTestPage(user.id, {
      title: 'Inherited ACL target',
      parentId: folder.id,
    });
    await query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('folder', $1, $2, $3, 'view')`,
      [folder.id, user.id, recipient.id],
    );
    await query('update pages set ydoc = $1 where id = $2', [
      Buffer.from(markdownToYjsState('Searchable body text')),
      page.id,
    ]);

    process.env.MEILISEARCH_URL = 'http://indexer-meili.test';
    process.env.MEILI_MASTER_KEY = 'indexer-test-master-key';
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (!url.startsWith('http://indexer-meili.test')) return originalFetch(input, init);
      if (url.endsWith('/indexes/metakip_pages')) {
        return Response.json({ uid: 'metakip_pages', createdAt: '2026-01-01T00:00:00Z' });
      }
      if (url.includes('/settings')) return Response.json({ taskUid: 1 });
      if (url.endsWith('/tasks/1')) return Response.json({ status: 'succeeded' });
      if (url.endsWith('/documents') && init?.method === 'POST') {
        indexedDocuments.push(...(JSON.parse(String(init.body)) as typeof indexedDocuments));
        return Response.json({ taskUid: 2 });
      }
      if (url.endsWith('/tasks/2')) return Response.json({ status: 'succeeded' });
      if (url.endsWith('/documents/delete-batch')) {
        const body: unknown = JSON.parse(String(init?.body));
        if (!Array.isArray(body) || !body.every((id) => typeof id === 'string')) {
          return Response.json({ message: 'Expected an array of document IDs' }, { status: 400 });
        }
        deletedBatches.push(body);
        return Response.json({ taskUid: 3 });
      }
      if (url.endsWith('/tasks/3')) return Response.json({ status: 'succeeded' });
      throw new Error(`Unexpected Meilisearch request: ${url}`);
    }) as typeof fetch;

    const client = createMeilisearchClient();
    if (!client) throw new Error('Meilisearch test configuration was not applied');
    await client.ensurePageIndex();
    await drainPageSearchIndexQueue();
    await drainFolderSearchIndexQueue();

    expect(indexedDocuments).toContainEqual({
      id: searchDocumentId('page', page.id),
      type: 'page',
      entityId: page.id,
      title: 'Indexing target',
      content: 'Searchable body text',
      accessTokens: expect.arrayContaining([`user:${user.id}`, `workspace:${user.id}`]),
    });
    expect(indexedDocuments).toContainEqual({
      id: searchDocumentId('folder', folder.id),
      type: 'folder',
      entityId: folder.id,
      title: 'Searchable folder',
      content: '',
      accessTokens: expect.arrayContaining([`user:${user.id}`, `workspace:${user.id}`]),
    });
    expect(indexedDocuments).toContainEqual({
      id: searchDocumentId('page', inheritedPage.id),
      type: 'page',
      entityId: inheritedPage.id,
      title: 'Inherited ACL target',
      content: '',
      accessTokens: expect.arrayContaining([`user:${recipient.id}`]),
    });

    await query('delete from shares where entity_id = $1', [folder.id]);
    const queuedAfterShareRemoval = await query<{ count: string }>(
      'select count(*)::text as count from search_index_queue where page_id = $1',
      [inheritedPage.id],
    );
    expect(queuedAfterShareRemoval.rows[0]?.count).toBe('1');
    const queuedBeforeDelete = await query<{ count: string }>(
      'select count(*)::text as count from search_index_queue where page_id = $1',
      [page.id],
    );
    expect(queuedBeforeDelete.rows[0]?.count).toBe('0');

    await query('update pages set is_deleted = true where id = $1', [page.id]);
    await drainPageSearchIndexQueue();
    expect(deletedBatches).toContainEqual([searchDocumentId('page', page.id)]);

    await query('update folders set is_deleted = true where id = $1', [folder.id]);
    await drainFolderSearchIndexQueue();
    expect(deletedBatches).toContainEqual([searchDocumentId('folder', folder.id)]);
  });
});
