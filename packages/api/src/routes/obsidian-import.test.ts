import { MAX_FOLDER_NAME_LENGTH, MAX_PAGE_TITLE_LENGTH, MAX_YDOC_BYTES } from '@metakip/shared';
import { extractConnectionsFromYDoc } from '@metakip/shared/yjs-helpers';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import { createTestApp, createTestSession, createTestUser } from '../test-utils';

async function flushPageContentNotifications(payloads: string[]): Promise<string[]> {
  const marker = `page-content-notification-marker:${crypto.randomUUID()}`;
  await query("select pg_notify('page_content_replaced', $1)", [marker]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const markerIndex = payloads.indexOf(marker);
    if (markerIndex >= 0) return payloads.splice(0, markerIndex + 1).slice(0, -1);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out flushing page content replacement notifications');
}

describe('obsidian import API', () => {
  describe('auth guard', () => {
    it('returns 401 without session cookie', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/import/obsidian', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid session token', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/import/obsidian', () => {
    it('returns 400 for empty import request', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [] }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for Markdown files without content', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ path: 'missing.md' }] }),
      });

      expect(res.status).toBe(400);
    });

    it('imports a simple markdown file (happy path)', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [{ path: 'note.md', content: '# Hello\n\nWorld' }],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.pagesCreated).toBeGreaterThanOrEqual(1);
    });

    it('imports markdown with an empty tags property', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [{ path: 'untagged.md', content: '---\ntags:\n---\n\n# Untagged' }],
        }),
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ pagesCreated: 1, errors: [] });
      const persisted = await query<{ properties: unknown }>(
        'select properties from pages where title = $1 and created_by = $2',
        ['untagged', user.id],
      );
      expect(persisted.rows[0]?.properties).toEqual({ tags: [] });
    });

    it('reports an over-limit filename without creating an invalid page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [{ path: `${'x'.repeat(MAX_PAGE_TITLE_LENGTH + 1)}.md`, content: 'Body' }],
        }),
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({
        pagesCreated: 0,
        errors: [expect.stringContaining(`Title must be ${MAX_PAGE_TITLE_LENGTH}`)],
      });
    });

    it('reports an over-limit folder path without creating the folder', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const oversizedFolder = '📁'.repeat(MAX_FOLDER_NAME_LENGTH + 1);

      const response = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [{ path: `${oversizedFolder}/note.md`, content: 'Body' }],
        }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        foldersCreated: 0,
        pagesCreated: 0,
        errors: expect.arrayContaining([
          expect.stringContaining(`Folder name must be ${MAX_FOLDER_NAME_LENGTH}`),
        ]),
      });
      const folders = await query<{ count: string }>(
        'select count(*)::text as count from folders where created_by = $1',
        [user.id],
      );
      expect(folders.rows[0]?.count).toBe('0');
    });

    it('reports oversized markdown without creating an inaccessible page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [{ path: 'oversized.md', content: 'x'.repeat(MAX_YDOC_BYTES + 1) }],
        }),
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({
        pagesCreated: 0,
        errors: [expect.stringContaining('Document must be')],
      });
    });

    it('imports nested folders', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [
            { path: 'Projects/note.md', content: '# Project Note' },
            { path: 'Projects/Subproject/note2.md', content: '# Subproject Note' },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.foldersCreated).toBeGreaterThanOrEqual(2);
      expect(body.pagesCreated).toBe(2);
    });

    it('keeps frontmatter and inline tags indexed after resolving imported links', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [
            {
              path: 'tagged.md',
              content:
                '---\ntags:\n  - review\n  - urgent\nmetadata:\n  author: Alice\n  published: true\n---\n\n# Tagged Note\n\n#inline',
            },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.pagesCreated).toBeGreaterThanOrEqual(1);

      const tags = await app.request('/api/tags', { headers: { Cookie: session.Cookie } });
      expect(tags.status).toBe(200);
      expect(await tags.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: '#inline', page_count: '1' }),
          expect.objectContaining({ id: '#review', page_count: '1' }),
          expect.objectContaining({ id: '#urgent', page_count: '1' }),
        ]),
      );
      const persisted = await query<{ properties: unknown }>(
        'select properties from pages where title = $1',
        ['tagged'],
      );
      expect(persisted.rows[0]?.properties).toEqual({
        tags: ['review', 'urgent'],
        metadata: { author: 'Alice', published: true },
      });
    });

    it('imports images as base64', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [
            { path: 'note.md', content: '# Note' },
            {
              path: 'image.png',
              data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString(
                'base64',
              ),
              mimeType: 'image/png',
            },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.imagesUploaded).toBeGreaterThanOrEqual(1);
    });

    it('skips SVG and reports it as unsupported', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [
            { path: 'note.md', content: '# Note\n![[unsafe.svg]]' },
            {
              path: 'unsafe.svg',
              data: Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64'),
              mimeType: 'image/svg+xml',
            },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.imagesUploaded).toBe(0);
      expect(body.errors).toContainEqual(expect.stringContaining('Skipped unsupported image'));
    });

    it('creates backlinks between pages', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [
            { path: 'Page A.md', content: '# Page A\n\nSee [[Page B]] for details' },
            { path: 'Page B.md', content: '# Page B\n\nBacklink target' },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.backlinksCreated).toBeGreaterThanOrEqual(1);

      const importedPages = await query<{ id: string; title: string; ydoc: Buffer }>(
        `select id, title, ydoc
         from pages
         where created_by = $1 and title in ('Page A', 'Page B')`,
        [user.id],
      );
      const pageA = importedPages.rows.find((page) => page.title === 'Page A');
      const pageB = importedPages.rows.find((page) => page.title === 'Page B');
      expect(pageA).toBeDefined();
      expect(pageB).toBeDefined();
      const connections = extractConnectionsFromYDoc(new Uint8Array(pageA?.ydoc ?? []));
      expect(connections).toContainEqual(
        expect.objectContaining({ targetSlug: `id:${pageB?.id}`, targetId: pageB?.id }),
      );
      const indexed = await query<{ target_id: string | null; target_slug: string }>(
        `select target_id, target_slug
         from connections
         where source_type = 'page' and source_id = $1 and target_slug = $2`,
        [pageA?.id, `id:${pageB?.id}`],
      );
      expect(indexed.rows).toContainEqual({
        target_id: pageB?.id,
        target_slug: `id:${pageB?.id}`,
      });
      expect(pageA?.ydoc.includes(Buffer.from(pageB?.id ?? ''))).toBe(true);
      expect(pageA?.ydoc.includes(Buffer.from('Page B'))).toBe(false);
    });

    it('notifies collaborators when deferred link binding replaces page content', async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) throw new Error('DATABASE_URL is required');

      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const listener = new Client({ connectionString });
      const payloads: string[] = [];
      listener.on('notification', (notification) => {
        if (notification.channel === 'page_content_replaced' && notification.payload) {
          payloads.push(notification.payload);
        }
      });
      await listener.connect();
      await listener.query('listen page_content_replaced');

      try {
        const response = await app.request('/api/import/obsidian', {
          method: 'POST',
          headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: [
              { path: 'Source.md', content: '# Source\n\nSee [[Target]]' },
              { path: 'Target.md', content: '# Target' },
            ],
          }),
        });
        expect(response.status).toBe(201);

        const source = await query<{ id: string }>(
          'select id from pages where created_by = $1 and title = $2',
          [user.id, 'Source'],
        );
        const sourcePageId = source.rows[0]?.id;
        if (!sourcePageId) throw new Error('Imported source page was not found');
        const notifications = await flushPageContentNotifications(payloads);
        expect(notifications.map((payload) => JSON.parse(payload))).toContainEqual({
          pageId: sourcePageId,
        });
      } finally {
        await listener.end();
      }
    });

    it('handles invalid body gracefully', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: 'not-json',
      });

      expect(res.status).toBe(400);
    });

    it('handles missing files field', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/obsidian', {
        method: 'POST',
        headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });
});
