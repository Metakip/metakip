import { MAX_YDOC_BYTES } from '@metakip/shared';
import { describe, expect, it } from 'vitest';
import { testQuery } from '../../db/testQuery';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../../test-utils';

describe('v1 lifecycle API', () => {
  it('returns 401 without session', async () => {
    const app = await createTestApp();

    const response = await app.request('/api/v1/trash/pages');

    expect(response.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const app = await createTestApp();

    const response = await app.request('/api/v1/trash/pages', {
      headers: { Authorization: 'Bearer invalid-token' },
    });

    expect(response.status).toBe(401);
  });

  it('authenticates protected lifecycle operations before parsing requests', async () => {
    const app = await createTestApp();

    const writeResponse = await app.request('/api/v1/pages/not-a-uuid/move', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(writeResponse.status).toBe(401);

    const importResponse = await app.request('/api/v1/imports/obsidian', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(importResponse.status).toBe(401);

    const exportResponse = await app.request('/api/v1/exports/workspace');
    expect(exportResponse.status).toBe(401);
  });

  it('resolves enumerable folder and page paths through the shared path CTE', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const root = await createTestFolder(user.id, { name: 'Root' });
    const child = await createTestFolder(user.id, { name: 'Child', parentId: root.id });
    await createTestPage(user.id, { title: 'Nested page', parentId: child.id });

    const folderResponse = await app.request('/api/v1/folders/resolve?name=Child', {
      headers: session,
    });
    expect(folderResponse.status).toBe(200);
    expect(await folderResponse.json()).toMatchObject({
      data: [{ id: child.id, folderPath: '/Root/Child' }],
    });

    const pageResponse = await app.request('/api/v1/pages/resolve?title=Nested%20page', {
      headers: session,
    });
    expect(pageResponse.status).toBe(200);
    expect(await pageResponse.json()).toMatchObject({
      data: [{ folderPath: '/Root/Child' }],
    });
  });

  it('rejects browser-only mutation fields', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id, { title: 'Original' });

    const response = await app.request(`/api/v1/pages/${page.id}/move`, {
      method: 'PATCH',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: null, title: 'Not exposed by v1' }),
    });

    expect(response.status).toBe(400);
    const stored = await testQuery<{ title: string }>('select title from pages where id = $1', [
      page.id,
    ]);
    expect(stored.rows[0]?.title).toBe('Original');
  });

  it('atomically renames and moves a folder', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const source = await createTestFolder(user.id, { name: 'Source' });
    const destination = await createTestFolder(user.id, { name: 'Destination' });
    const child = await createTestFolder(user.id, { name: 'Before', parentId: source.id });

    const response = await app.request(`/api/v1/folders/${child.id}`, {
      method: 'PATCH',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'After', parentId: destination.id }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: child.id,
      name: 'After',
      parentId: destination.id,
    });
    const stored = await testQuery<{ name: string; parent_id: string | null }>(
      'select name, parent_id from folders where id = $1',
      [child.id],
    );
    expect(stored.rows[0]).toEqual({ name: 'After', parent_id: destination.id });
  });

  it('restores and permanently deletes recursive folder Trash batches', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const root = await createTestFolder(user.id, { name: 'Root' });
    const child = await createTestFolder(user.id, { name: 'Child', parentId: root.id });
    const page = await createTestPage(user.id, { parentId: child.id });

    const trash = () =>
      app.request(`/api/v1/folders/${root.id}/trash?force=true`, {
        method: 'DELETE',
        headers: session,
      });
    expect((await trash()).status).toBe(200);

    const restore = await app.request(`/api/v1/folders/${root.id}/restore`, {
      method: 'PATCH',
      headers: session,
    });
    expect(restore.status).toBe(200);
    expect(await restore.json()).toEqual({ id: root.id });

    expect((await trash()).status).toBe(200);
    const permanent = await app.request(`/api/v1/folders/${root.id}/permanent`, {
      method: 'DELETE',
      headers: session,
    });
    expect(permanent.status).toBe(200);
    expect(await permanent.json()).toMatchObject({ deleted: true, folders: 2, pages: 1 });

    const remaining = await testQuery<{ count: string }>(
      `select (
         (select count(*) from folders where id = any($1::uuid[])) +
         (select count(*) from pages where id = $2)
       )::text as count`,
      [[root.id, child.id], page.id],
    );
    expect(remaining.rows[0]?.count).toBe('0');
  });

  it('uses direct parent ownership fallback consistently for deleted lifecycle items', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const creator = await createTestUser();
    const session = await createTestSession(owner.id);
    const root = await createTestFolder(owner.id, { name: 'Owner root' });
    const pageParent = await createTestFolder(owner.id, {
      name: 'Page parent',
      parentId: root.id,
    });
    const permanentFolder = await createTestFolder(creator.id, {
      name: 'Permanent folder',
      parentId: root.id,
    });
    const emptiedFolder = await createTestFolder(creator.id, {
      name: 'Emptied folder',
      parentId: root.id,
    });
    const restoredPage = await createTestPage(creator.id, { parentId: pageParent.id });
    const permanentPage = await createTestPage(creator.id, { parentId: pageParent.id });
    const emptiedPage = await createTestPage(creator.id, { parentId: pageParent.id });

    for (const page of [restoredPage, permanentPage, emptiedPage]) {
      expect(
        (
          await app.request(`/api/v1/pages/${page.id}/trash`, {
            method: 'DELETE',
            headers: session,
          })
        ).status,
      ).toBe(200);
    }
    for (const folder of [permanentFolder, emptiedFolder]) {
      expect(
        (
          await app.request(`/api/v1/folders/${folder.id}/trash`, {
            method: 'DELETE',
            headers: session,
          })
        ).status,
      ).toBe(200);
    }

    // Simulate a legacy hierarchy whose direct parent remains but root closure
    // rows were removed. The parent owner must still govern deleted children.
    await testQuery(
      'delete from folder_closure where ancestor_id = $1 and descendant_id = any($2::uuid[])',
      [root.id, [pageParent.id, permanentFolder.id, emptiedFolder.id]],
    );

    const pages = await app.request('/api/v1/trash/pages', { headers: session });
    expect(pages.status).toBe(200);
    expect(await pages.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: restoredPage.id }),
        expect.objectContaining({ id: permanentPage.id }),
        expect.objectContaining({ id: emptiedPage.id }),
      ]),
    );
    const folders = await app.request('/api/v1/trash/folders', { headers: session });
    expect(folders.status).toBe(200);
    expect(await folders.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: permanentFolder.id }),
        expect.objectContaining({ id: emptiedFolder.id }),
      ]),
    );

    expect(
      (
        await app.request(`/api/v1/pages/${restoredPage.id}/restore`, {
          method: 'PATCH',
          headers: session,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/pages/${permanentPage.id}/permanent`, {
          method: 'DELETE',
          headers: session,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/folders/${permanentFolder.id}/permanent`, {
          method: 'DELETE',
          headers: session,
        })
      ).status,
    ).toBe(200);
    const empty = await app.request('/api/v1/trash/empty', {
      method: 'DELETE',
      headers: session,
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ deleted: true, folders: 1, pages: 1 });
  });

  it('returns only documented lifecycle mutation and Trash DTO fields', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id);
    const folder = await createTestFolder(user.id);

    const movedPage = await app.request(`/api/v1/pages/${page.id}/move`, {
      method: 'PATCH',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: null }),
    });
    expect(movedPage.status).toBe(200);
    expect(await movedPage.json()).toEqual({ id: page.id });

    const copiedFolder = await app.request(`/api/v1/folders/${folder.id}/copy`, {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: null }),
    });
    expect(copiedFolder.status).toBe(201);
    const copiedFolderBody = (await copiedFolder.json()) as Record<string, unknown>;
    expect(Object.keys(copiedFolderBody).sort()).toEqual(['id', 'skippedRestrictedItems']);

    const trashPage = await app.request(`/api/v1/pages/${page.id}/trash`, {
      method: 'DELETE',
      headers: session,
    });
    expect(trashPage.status).toBe(200);
    expect(await trashPage.json()).toEqual({ deleted: true });

    const trashedPages = await app.request('/api/v1/trash/pages', { headers: session });
    expect(trashedPages.status).toBe(200);
    const trashedPageBody = (await trashedPages.json()) as Array<Record<string, unknown>>;
    expect(trashedPageBody).toHaveLength(1);
    expect(Object.keys(trashedPageBody[0] ?? {}).sort()).toEqual([
      'deletedAt',
      'icon',
      'id',
      'title',
    ]);
  });

  it('rejects empty Obsidian vault imports', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);

    const response = await app.request('/api/v1/imports/obsidian', {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [] }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: '400', message: 'files array is required' },
    });
  });

  it('rejects malformed Obsidian Markdown and image entries', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);

    for (const file of [{ path: 'Missing.md' }, { path: 'image.png', mimeType: 'image/png' }]) {
      const response = await app.request('/api/v1/imports/obsidian', {
        method: 'POST',
        headers: { ...session, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [file] }),
      });
      expect(response.status).toBe(400);
    }
  });

  it('rejects unsafe, duplicate, and unsupported-only vault input', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const invalidFiles = [
      [{ path: '../outside.md', content: '# Outside' }],
      [{ path: '/absolute.md', content: '# Absolute' }],
      [
        { path: 'Duplicate.md', content: '# First' },
        { path: 'Duplicate.md', content: '# Second' },
      ],
      [{ path: 'attachments/archive.pdf' }],
    ];

    for (const files of invalidFiles) {
      const response = await app.request('/api/v1/imports/obsidian', {
        method: 'POST',
        headers: { ...session, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      expect(response.status).toBe(400);
    }
    const folders = await testQuery<{ count: string }>(
      'select count(*)::text as count from folders where created_by = $1',
      [user.id],
    );
    expect(folders.rows[0]?.count).toBe('0');
  });

  it('derives vault folders only from importable files', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);

    const response = await app.request('/api/v1/imports/obsidian', {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ path: 'attachments/archive.pdf' }, { path: 'notes/Note.md', content: '# Note' }],
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ foldersCreated: 1, pagesCreated: 1, errors: [] });
    const folders = await testQuery<{ name: string }>(
      'select name from folders where created_by = $1 order by name',
      [user.id],
    );
    expect(folders.rows).toEqual([{ name: 'notes' }]);
  });

  it('imports empty Obsidian Markdown files as blank pages', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);

    const response = await app.request('/api/v1/imports/obsidian', {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ path: 'Blank.md', content: '' }] }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ pagesCreated: 1, errors: [] });
    const pages = await testQuery<{ title: string }>(
      'select title from pages where created_by = $1',
      [user.id],
    );
    expect(pages.rows).toEqual([{ title: 'Blank' }]);
  });

  it('imports uppercase Obsidian Markdown extensions', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);

    const response = await app.request('/api/v1/imports/obsidian', {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ path: 'Uppercase.MD', content: '# Imported' }] }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ pagesCreated: 1, errors: [] });
    const pages = await testQuery<{ title: string }>(
      'select title from pages where created_by = $1',
      [user.id],
    );
    expect(pages.rows).toEqual([{ title: 'Uppercase' }]);
  });

  it('accepts vault import requests larger than the lifecycle JSON mutation limit', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const content = `# Large note\n${'x'.repeat(64 * 1024)}`;

    const response = await app.request('/api/v1/imports/obsidian', {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ path: 'Large.md', content }] }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ pagesCreated: 1, errors: [] });
  });

  it('requires a Markdown import file', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);

    const response = await app.request('/api/v1/imports/markdown', {
      method: 'POST',
      headers: session,
      body: new FormData(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: '400', message: 'File is required' } });
  });

  it('rejects an oversized Markdown upload before importing its text', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const formData = new FormData();
    formData.append(
      'file',
      new File(['x'.repeat(MAX_YDOC_BYTES + 1)], 'oversized.md', { type: 'text/markdown' }),
    );

    const response = await app.request('/api/v1/imports/markdown', {
      method: 'POST',
      headers: session,
      body: formData,
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'DOCUMENT_TOO_LARGE' } });
  });

  it('records token lifecycle audit events for explicit v1 mutations', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const tokenResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lifecycle test', scopes: ['pages:read', 'pages:write'] }),
    });
    expect(tokenResponse.status).toBe(201);
    const tokenBody = (await tokenResponse.json()) as { id: string; token: string };

    const createResponse = await app.request('/api/v1/folders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenBody.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Audited folder' }),
    });
    expect(createResponse.status).toBe(201);

    const audit = await testQuery<{ operation: string; result: string }>(
      `select operation, result from api_token_audit_events
       where token_id = $1 order by created_at desc limit 1`,
      [tokenBody.id],
    );
    expect(audit.rows[0]).toEqual({ operation: 'folder.lifecycle', result: 'success' });
  });

  it('uses dedicated audit operations for Trash and imports', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id);
    const tokenResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lifecycle audit operations', scopes: ['pages:write'] }),
    });
    expect(tokenResponse.status).toBe(201);
    const tokenBody = (await tokenResponse.json()) as { id: string; token: string };
    const headers = { Authorization: `Bearer ${tokenBody.token}` };

    expect(
      (
        await app.request(`/api/v1/pages/${page.id}/trash`, {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request('/api/v1/trash/empty', {
          method: 'DELETE',
          headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request('/api/v1/imports/obsidian', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [{ path: 'Imported.md', content: '# Imported' }] }),
        })
      ).status,
    ).toBe(201);

    const audit = await testQuery<{ operation: string }>(
      `select operation from api_token_audit_events
       where token_id = $1
         and operation in ('page.lifecycle', 'trash.lifecycle', 'import.lifecycle')
       order by operation`,
      [tokenBody.id],
    );
    expect(audit.rows).toEqual([
      { operation: 'import.lifecycle' },
      { operation: 'page.lifecycle' },
      { operation: 'trash.lifecycle' },
    ]);
  });

  it('allows read-only tokens to list Trash but not mutate it', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id);
    const folder = await createTestFolder(user.id);
    expect(
      (
        await app.request(`/api/v1/pages/${page.id}/trash`, {
          method: 'DELETE',
          headers: session,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/v1/folders/${folder.id}/trash`, {
          method: 'DELETE',
          headers: session,
        })
      ).status,
    ).toBe(200);

    const tokenResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Read-only Trash', scopes: ['pages:read'] }),
    });
    const token = ((await tokenResponse.json()) as { token: string }).token;
    const headers = { Authorization: `Bearer ${token}` };

    const pages = await app.request('/api/v1/trash/pages', { headers });
    expect(pages.status).toBe(200);
    expect(await pages.json()).toMatchObject([{ id: page.id }]);
    const folders = await app.request('/api/v1/trash/folders', { headers });
    expect(folders.status).toBe(200);
    expect(await folders.json()).toMatchObject([{ id: folder.id }]);
    const mutation = await app.request(`/api/v1/pages/${page.id}/permanent`, {
      method: 'DELETE',
      headers,
    });
    expect(mutation.status).toBe(403);
    expect(await mutation.json()).toMatchObject({ error: { code: 'insufficient_scope' } });
  });

  it('applies lifecycle write scope independently of read handlers', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id);
    const tokenResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: { ...session, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Read-only lifecycle scope', scopes: ['pages:read'] }),
    });
    const token = ((await tokenResponse.json()) as { token: string }).token;
    const headers = { Authorization: `Bearer ${token}` };

    const list = await app.request('/api/v1/trash/pages', { headers });
    expect(list.status).toBe(200);
    const mutation = await app.request(`/api/v1/pages/${page.id}/trash`, {
      method: 'DELETE',
      headers,
    });
    expect(mutation.status).toBe(403);
    expect(await mutation.json()).toMatchObject({ error: { code: 'insufficient_scope' } });
  });

  it('validates lifecycle IDs before parsing request bodies or accessing the database', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const requests = [
      ['POST', '/api/v1/pages/not-a-uuid/copy'],
      ['PATCH', '/api/v1/pages/not-a-uuid/move'],
      ['DELETE', '/api/v1/pages/not-a-uuid/trash'],
      ['PATCH', '/api/v1/pages/not-a-uuid/restore'],
      ['DELETE', '/api/v1/pages/not-a-uuid/permanent'],
      ['POST', '/api/v1/folders/not-a-uuid/copy'],
      ['DELETE', '/api/v1/folders/not-a-uuid/trash'],
      ['PATCH', '/api/v1/folders/not-a-uuid/restore'],
      ['DELETE', '/api/v1/folders/not-a-uuid/permanent'],
      ['GET', '/api/v1/pages/not-a-uuid/export/markdown'],
    ] as const;

    for (const [method, path] of requests) {
      const response = await app.request(path, { method, headers: session });
      expect(response.status, `${method} ${path}`).toBe(400);
      expect(await response.json(), `${method} ${path}`).toMatchObject({
        error: { code: '400' },
      });
    }
  });

  it('uses the v1 error envelope when recursive folder Trash confirmation is required', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const folder = await createTestFolder(user.id);
    await createTestPage(user.id, { parentId: folder.id });

    const response = await app.request(`/api/v1/folders/${folder.id}/trash`, {
      method: 'DELETE',
      headers: session,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: 'FOLDER_NOT_EMPTY',
        message: 'Folder is not empty. Confirm recursive deletion to continue.',
      },
    });
  });
});
