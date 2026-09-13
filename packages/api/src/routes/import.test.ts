import { MAX_PAGE_TITLE_LENGTH, MAX_YDOC_BYTES } from '@metakip/shared';
import { extractConnectionsFromYDoc, yDocToMarkdown } from '@metakip/shared/yjs-helpers';
import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../test-utils';

describe('markdown import API', () => {
  describe('auth guard', () => {
    it('returns 401 without session cookie', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/import/markdown', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid session token', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/import/markdown', () => {
    it('imports markdown content', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const formData = new FormData();
      formData.append('file', new File(['# Hello World'], 'note.md', { type: 'text/markdown' }));

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.page).toEqual({ id: expect.any(String), title: 'note' });
      expect(body.warnings).toEqual([]);
    });

    it('imports markdown with frontmatter', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const content = `---
title: Frontmatter Title
---

# Hello

Body text`;
      const formData = new FormData();
      formData.append('file', new File([content], 'note.md', { type: 'text/markdown' }));

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.page.title).toBe('note');
      const persisted = await query<{ properties: unknown }>(
        'select properties from pages where id = $1',
        [body.page.id],
      );
      expect(persisted.rows[0]?.properties).toEqual({ title: 'Frontmatter Title' });
    });

    it('preserves nested JSON-compatible frontmatter properties', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const formData = new FormData();
      formData.append(
        'file',
        new File(['---\nauthor:\n  name: Alice\n  verified: true\n---\nBody'], 'note.md', {
          type: 'text/markdown',
        }),
      );

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      const persisted = await query<{ properties: unknown }>(
        'select properties from pages where id = $1',
        [body.page.id],
      );
      expect(persisted.rows[0]?.properties).toEqual({
        author: { name: 'Alice', verified: true },
      });
    });

    it('rejects an imported title above the collaboration title limit', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const title = 'x'.repeat(MAX_PAGE_TITLE_LENGTH + 1);
      const formData = new FormData();
      formData.append('file', new File(['Body'], `${title}.md`, { type: 'text/markdown' }));

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        message: `Title must be ${MAX_PAGE_TITLE_LENGTH} characters or fewer`,
      });
    });

    it('binds imported wiki links within the destination workspace', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const otherOwner = await createTestUser();
      const session = await createTestSession(user.id);
      const ownTarget = await createTestPage(user.id, { title: 'Roadmap' });
      await createTestPage(otherOwner.id, { title: 'Roadmap' });
      const formData = new FormData();
      formData.append(
        'file',
        new File(['# Imported\n\nSee [[Roadmap]] and [[Roadmap|Plan]]'], 'imported.md', {
          type: 'text/markdown',
        }),
      );

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(201);
      const imported = (await res.json()) as { page: { id: string } };
      const ydocResult = await query<{ ydoc: Buffer }>('SELECT ydoc FROM pages WHERE id = $1', [
        imported.page.id,
      ]);
      const connections = extractConnectionsFromYDoc(
        new Uint8Array(ydocResult.rows[0]?.ydoc ?? []),
      );
      expect(connections).toContainEqual(
        expect.objectContaining({
          targetSlug: `id:${ownTarget.id}`,
          targetId: ownTarget.id,
        }),
      );
      expect(ydocResult.rows[0]?.ydoc.includes(Buffer.from(ownTarget.id))).toBe(true);
      expect(ydocResult.rows[0]?.ydoc.includes(Buffer.from('Roadmap'))).toBe(false);
      const indexed = await query<{ occurrence_count: number; context: string | null }>(
        `select c.occurrence_count, co.context
         from connections c
         join connection_occurrences co on co.connection_id = c.id
         where c.source_id = $1 and c.target_id = $2`,
        [imported.page.id, ownTarget.id],
      );
      expect(indexed.rows).toHaveLength(2);
      expect(indexed.rows.every((row) => row.occurrence_count === 2)).toBe(true);
      expect(indexed.rows.every((row) => typeof row.context === 'string')).toBe(true);
    });

    it('binds only targets the importer can access inside a shared folder', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const importer = await createTestUser();
      const session = await createTestSession(importer.id);
      const sharedFolder = await createTestFolder(owner.id, { name: 'Shared' });
      const visibleTarget = await createTestPage(owner.id, {
        title: 'Visible in shared folder',
        parentId: sharedFolder.id,
      });
      const hiddenTarget = await createTestPage(owner.id, { title: 'Hidden owner page' });
      await query(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('folder', $1, $2, $3, 'admin')`,
        [sharedFolder.id, owner.id, importer.id],
      );
      const formData = new FormData();
      formData.append(
        'file',
        new File(
          ['# Imported\n\n[[Visible in shared folder]] and [[Hidden owner page]]'],
          'imported.md',
          { type: 'text/markdown' },
        ),
      );

      const res = await app.request(`/api/import/markdown?parentId=${sharedFolder.id}`, {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(201);
      const imported = (await res.json()) as { page: { id: string } };
      const ydocResult = await query<{ ydoc: Buffer }>('select ydoc from pages where id = $1', [
        imported.page.id,
      ]);
      const connections = extractConnectionsFromYDoc(
        new Uint8Array(ydocResult.rows[0]?.ydoc ?? []),
      );
      expect(connections).toContainEqual(
        expect.objectContaining({
          targetSlug: `id:${visibleTarget.id}`,
          targetId: visibleTarget.id,
        }),
      );
      expect(
        connections.find((connection) => connection.targetSlug === 'hidden owner page')?.targetId,
      ).toBeUndefined();
      expect(connections.some((connection) => connection.targetId === hiddenTarget.id)).toBe(false);
      expect(ydocResult.rows[0]?.ydoc.includes(Buffer.from(visibleTarget.id))).toBe(true);
    });

    it('binds explicit paths while leaving duplicate titles unresolved', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      await createTestPage(user.id, { title: 'Roadmap' });
      const plans = await createTestFolder(user.id, { name: 'Plans' });
      const pathTarget = await createTestPage(user.id, {
        title: 'Roadmap',
        parentId: plans.id,
      });
      const formData = new FormData();
      formData.append(
        'file',
        new File(
          ['# Imported\n\nExact [[Plans/Roadmap]] and ambiguous [[Roadmap]]'],
          'imported.md',
          { type: 'text/markdown' },
        ),
      );

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(201);
      const imported = (await res.json()) as { page: { id: string } };
      const ydocResult = await query<{ ydoc: Buffer }>('SELECT ydoc FROM pages WHERE id = $1', [
        imported.page.id,
      ]);
      const connections = extractConnectionsFromYDoc(
        new Uint8Array(ydocResult.rows[0]?.ydoc ?? []),
      );
      expect(connections).toContainEqual(
        expect.objectContaining({
          targetSlug: `id:${pathTarget.id}`,
          targetId: pathTarget.id,
        }),
      );
      const ambiguous = connections.find((connection) => connection.targetSlug === 'roadmap');
      expect(ambiguous?.targetId).toBeUndefined();
      expect(ydocResult.rows[0]?.ydoc.includes(Buffer.from(pathTarget.id))).toBe(true);
    });

    it('preserves image references and warns when local image files were not provided', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const content = [
        '# Images',
        '',
        '![Local](images/diagram.png)',
        '![Remote](https://example.com/logo.png)',
        '<img src="file:///tmp/photo.jpg">',
        '![[assets/sketch.webp]]',
      ].join('\n');
      const formData = new FormData();
      formData.append('file', new File([content], 'images.md', { type: 'text/markdown' }));

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(201);
      const imported = (await res.json()) as {
        page: { id: string };
        warnings: { code: string; count: number }[];
      };
      expect(imported.warnings).toEqual([
        expect.objectContaining({ code: 'LOCAL_IMAGES_NOT_IMPORTED', count: 3 }),
      ]);

      const stored = await query<{ ydoc: Buffer }>('select ydoc from pages where id = $1', [
        imported.page.id,
      ]);
      const markdown = yDocToMarkdown(new Uint8Array(stored.rows[0]?.ydoc ?? []));
      expect(markdown).toContain('images/diagram.png');
      expect(markdown).toContain('https://example.com/logo.png');
      expect(markdown).not.toContain('/uploads/');
    });

    it('rejects oversized markdown before creating a page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const formData = new FormData();
      formData.append(
        'file',
        new File([new Uint8Array(MAX_YDOC_BYTES + 1)], 'oversized.md', {
          type: 'text/markdown',
        }),
      );

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ code: 'DOCUMENT_TOO_LARGE' });
      const pages = await query<{ count: string }>(
        'select count(*)::text as count from pages where created_by = $1',
        [user.id],
      );
      expect(pages.rows[0]?.count).toBe('0');
    });

    it('returns 400 when file is missing', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for non-markdown file', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const formData = new FormData();
      formData.append('file', new File(['plain text'], 'note.txt', { type: 'text/plain' }));

      const res = await app.request('/api/import/markdown', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(400);
    });
  });
});
