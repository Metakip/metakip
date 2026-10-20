import { markdownToYjsState } from '@metakip/shared/markdown-yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import { createMeilisearchClient, searchDocumentId } from '../search/meilisearch';
import { installMockMeilisearch } from '../test-support/mockMeilisearch';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../test-utils';

describe('search API', () => {
  let restoreMeilisearch: () => void = () => undefined;

  beforeEach(() => {
    restoreMeilisearch = installMockMeilisearch();
  });

  afterEach(() => {
    restoreMeilisearch();
  });

  describe('auth guard', () => {
    it('returns 401 without session cookie', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/search?q=test');
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid session token', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/search?q=test', {
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/search', () => {
    it('filters mocked Meilisearch hits by indexed access tokens', async () => {
      const owner = await createTestUser();
      const outsider = await createTestUser();
      const page = await createTestPage(owner.id, { title: 'Token fixture page' });
      const folder = await createTestFolder(owner.id, { name: 'Token fixture folder' });
      const client = createMeilisearchClient();
      if (!client) throw new Error('Meilisearch test configuration was not applied');

      const outsiderResults = await client.search('token fixture', 0, 20, [`user:${outsider.id}`]);
      expect(outsiderResults.hits).toEqual([]);

      const ownerResults = await client.search('token fixture', 0, 20, [`user:${owner.id}`]);
      expect(ownerResults.hits.map((hit) => hit.id)).toEqual(
        expect.arrayContaining([
          searchDocumentId('page', page.id),
          searchDocumentId('folder', folder.id),
        ]),
      );
    });

    it('returns pages matched by indexed body text while enforcing database access', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'Unrelated title' });
      const privateOwner = await createTestUser();
      const privatePage = await createTestPage(privateOwner.id, { title: 'Private result' });
      await query('update pages set ydoc = $1 where id = $2', [
        Buffer.from(markdownToYjsState('The body contains a rare phrase')),
        page.id,
      ]);

      const originalFetch = globalThis.fetch;
      process.env.MEILISEARCH_URL = 'http://meili.test';
      process.env.MEILI_MASTER_KEY = 'test-search-master-key';
      globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (!url.startsWith('http://meili.test')) return originalFetch(input, init);
        if (url.endsWith('/indexes/metakip_pages')) {
          return Response.json({ uid: 'metakip_pages', createdAt: '2026-01-01T00:00:00Z' });
        }
        if (url.includes('/settings')) return Response.json({ taskUid: 1 });
        if (url.endsWith('/tasks/1')) return Response.json({ status: 'succeeded' });
        if (url.endsWith('/search')) {
          const body = JSON.parse(String(init?.body)) as { q: string };
          return Response.json({
            hits:
              body.q === 'rare phrase'
                ? [
                    {
                      id: `page_${privatePage.id}`,
                      type: 'page',
                      entityId: privatePage.id,
                    },
                    { id: `page_${page.id}`, type: 'page', entityId: page.id },
                  ]
                : [],
            estimatedTotalHits: body.q === 'rare phrase' ? 2 : 0,
          });
        }
        throw new Error(`Unexpected Meilisearch request: ${url}`);
      }) as typeof fetch;

      try {
        const res = await app.request('/api/search?q=rare%20phrase', {
          headers: { Cookie: session.Cookie },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.results).toContainEqual(
          expect.objectContaining({ type: 'page', id: page.id, title: 'Unrelated title' }),
        );
        expect(JSON.stringify(body)).not.toContain(privatePage.id);
      } finally {
        globalThis.fetch = originalFetch;
        process.env.MEILISEARCH_URL = 'http://test-meilisearch.invalid';
        process.env.MEILI_MASTER_KEY = 'test-meilisearch-master-key';
      }
    });

    it('does not use the legacy PostgreSQL title search when Meilisearch is missing', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      await createTestPage(user.id, { title: 'Legacy title match' });
      delete process.env.MEILISEARCH_URL;
      delete process.env.MEILI_MASTER_KEY;

      const res = await app.request('/api/search?q=Legacy', {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ message: 'Search is temporarily unavailable' });
    });

    it('returns search results for a query matching page titles', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      await createTestPage(user.id, { title: 'Searchable Note' });

      const res = await app.request(`/api/search?q=Searchable`, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results.length).toBeGreaterThanOrEqual(1);
      expect(body.results[0].title).toBe('Searchable Note');
      expect(body.results[0].type).toBe('page');
      expect(body.results[0].titleMatches).toEqual([{ start: 0, end: 10 }]);
      expect(body.results[0]).not.toHaveProperty('snippet');
    });

    it('returns matching folders as navigable search results', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const parent = await createTestFolder(user.id, { name: 'Research/2026' });
      const folder = await createTestFolder(user.id, {
        name: 'Research/Folder',
        parentId: parent.id,
      });

      const res = await app.request('/api/search?q=Research%2FFolder', {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).results).toContainEqual(
        expect.objectContaining({
          type: 'folder',
          id: folder.id,
          title: 'Research/Folder',
          breadcrumb: ['Research/2026'],
          path: ['Research/2026', 'Research/Folder'],
        }),
      );
    });

    it('does not scan the Meilisearch index for tag-only searches', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'Tagged note' });
      await query(
        `insert into connections (source_id, target_type, target_slug, target_label, connection_type)
         values ($1, 'tag', '#research', 'research', 'tag')`,
        [page.id],
      );
      delete process.env.MEILISEARCH_URL;
      delete process.env.MEILI_MASTER_KEY;

      const res = await app.request('/api/search?q=tags%3A%23research', {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).results).toContainEqual(
        expect.objectContaining({ type: 'page', id: page.id, title: 'Tagged note' }),
      );
    });

    it('restricts text matches to pages with the requested tag before ranking', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      await createTestPage(user.id, { title: 'Notes without tag' });
      const tagged = await createTestPage(user.id, { title: 'Notes with tag' });
      await query(
        `insert into connections (source_id, target_type, target_slug, target_label, connection_type)
         values ($1, 'tag', '#research', 'research', 'tag')`,
        [tagged.id],
      );

      const response = await app.request('/api/search?q=notes%20tags%3A%23research', {
        headers: { Cookie: session.Cookie },
      });

      expect(response.status).toBe(200);
      expect((await response.json()).results.map((result: { id: string }) => result.id)).toEqual([
        tagged.id,
      ]);
    });

    it('returns empty results when query is empty', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request(`/api/search?q=`, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([]);
    });

    it('returns empty results when no matches found', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      await createTestPage(user.id, { title: 'Apple' });

      const res = await app.request(`/api/search?q=Zebra`, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([]);
    });

    it('returns 400 for an invalid parent filter instead of leaking a database error', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/search?q=test&parentId=not-a-uuid', {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: 'parentId must be a valid UUID or root' });
    });

    it('does not include deleted pages in results', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'Deleted Note' });

      await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      const res = await app.request(`/api/search?q=Deleted`, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toEqual([]);
    });

    it('does not expose private folder ancestry for a directly shared page', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const recipientSession = await createTestSession(recipient.id);
      const privateRoot = await createTestFolder(owner.id, { name: 'Private Ancestor' });
      const privateParent = await createTestFolder(owner.id, {
        name: 'Private Parent',
        parentId: privateRoot.id,
      });
      await query("update folders set public_permission = 'view' where id = $1", [
        privateParent.id,
      ]);
      const sharedPage = await createTestPage(owner.id, {
        title: 'Direct Share Search Result',
        parentId: privateParent.id,
      });
      await query(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('page', $1, $2, $3, 'view')`,
        [sharedPage.id, owner.id, recipient.id],
      );

      const res = await app.request('/api/search?q=Direct%20Share', {
        headers: { Cookie: recipientSession.Cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toContainEqual(
        expect.objectContaining({
          id: sharedPage.id,
          breadcrumb: [],
        }),
      );
      expect(JSON.stringify(body)).not.toContain('Private Ancestor');
      expect(JSON.stringify(body)).not.toContain('Private Parent');

      const hiddenParentFilterRes = await app.request(
        `/api/search?q=Direct%20Share&parentId=${privateParent.id}`,
        { headers: { Cookie: recipientSession.Cookie } },
      );
      expect(hiddenParentFilterRes.status).toBe(200);
      expect(await hiddenParentFilterRes.json()).toEqual({ results: [] });

      const redactedRootFilterRes = await app.request(
        '/api/search?q=Direct%20Share&parentId=root',
        { headers: { Cookie: recipientSession.Cookie } },
      );
      expect(redactedRootFilterRes.status).toBe(200);
      expect((await redactedRootFilterRes.json()).results).toContainEqual(
        expect.objectContaining({ id: sharedPage.id }),
      );

      const recordedFolderAccess = await query<{ count: string }>(
        `select count(*)::text as count
         from folder_public_access_visits
         where folder_id = $1 and user_id = $2`,
        [privateParent.id, recipient.id],
      );
      expect(recordedFolderAccess.rows[0]?.count).toBe('0');

      await query(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('folder', $1, $2, $3, 'view')`,
        [privateParent.id, owner.id, recipient.id],
      );

      const enumerableParentFilterRes = await app.request(
        `/api/search?q=Direct%20Share&parentId=${privateParent.id}`,
        { headers: { Cookie: recipientSession.Cookie } },
      );
      expect(enumerableParentFilterRes.status).toBe(200);
      expect((await enumerableParentFilterRes.json()).results).toContainEqual(
        expect.objectContaining({ id: sharedPage.id }),
      );
    });

    it('returns only the visible breadcrumb suffix for a folder-shared page', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const recipientSession = await createTestSession(recipient.id);
      const privateRoot = await createTestFolder(owner.id, { name: 'Hidden Workspace Root' });
      const sharedRoot = await createTestFolder(owner.id, {
        name: 'Shared Folder',
        parentId: privateRoot.id,
      });
      const visibleChild = await createTestFolder(owner.id, {
        name: 'Visible Child',
        parentId: sharedRoot.id,
      });
      const sharedPage = await createTestPage(owner.id, {
        title: 'Folder Share Search Result',
        parentId: visibleChild.id,
      });
      await query(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('folder', $1, $2, $3, 'view')`,
        [sharedRoot.id, owner.id, recipient.id],
      );

      const res = await app.request('/api/search?q=Folder%20Share', {
        headers: { Cookie: recipientSession.Cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toContainEqual(
        expect.objectContaining({
          id: sharedPage.id,
          breadcrumb: ['Shared Folder', 'Visible Child'],
        }),
      );
      expect(JSON.stringify(body)).not.toContain('Hidden Workspace Root');
    });
  });
});
