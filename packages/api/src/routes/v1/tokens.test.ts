import { describe, expect, it } from 'vitest';
import { testQuery } from '../../db/testQuery';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../../test-utils';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function issueToken(app: TestApp, userId: string, scopes: string[]): Promise<string> {
  const session = await createTestSession(userId);
  const response = await app.request('/api/v1/tokens', {
    method: 'POST',
    headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test agent', scopes }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

async function createToken(scopes: string[] = ['pages:read']): Promise<{
  app: Awaited<ReturnType<typeof createTestApp>>;
  token: string;
  id: string;
  userId: string;
}> {
  const app = await createTestApp();
  const user = await createTestUser();
  const session = await createTestSession(user.id);
  const response = await app.request('/api/v1/tokens', {
    method: 'POST',
    headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test agent', scopes }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { token: string; id: string };
  return { app, token: body.token, id: body.id, userId: user.id };
}

describe('v1 API tokens', () => {
  it('publishes the registered v1 operations in OpenAPI', async () => {
    const app = await createTestApp();
    const response = await app.request('/api/v1/openapi.json');
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(document.paths['/pages'] ?? {})).toEqual(
      expect.arrayContaining(['get', 'post']),
    );
    expect(Object.keys(document.paths['/pages/{pageId}/content'] ?? {})).toEqual(
      expect.arrayContaining(['get', 'put']),
    );
    expect(Object.keys(document.paths['/pages/resolve'] ?? {})).toContain('get');
    expect(Object.keys(document.paths['/tokens'] ?? {})).toEqual(
      expect.arrayContaining(['get', 'post']),
    );
  });

  it('uses the v1 error envelope for unknown routes', async () => {
    const app = await createTestApp();
    const response = await app.request('/api/v1/does-not-exist');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Not Found' },
    });
  });

  it('returns 401 without a browser session', async () => {
    const app = await createTestApp();
    const response = await app.request('/api/v1/tokens');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' },
    });
  });

  it('returns 401 with an invalid session token', async () => {
    const app = await createTestApp();
    const response = await app.request('/api/v1/tokens', {
      headers: { Cookie: 'better-auth.session_token=invalid-token' },
    });
    expect(response.status).toBe(401);
  });

  it('shows the secret once and authenticates the named token', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const createdResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Personal terminal' }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      token: string;
      scopes: string[];
    };
    expect(created.token).toMatch(/^mdn_/);
    expect(created.scopes).toEqual(['pages:read']);

    const listResponse = await app.request('/api/v1/tokens', {
      headers: { Cookie: session.Cookie },
    });
    const list = (await listResponse.json()) as { data: Array<Record<string, unknown>> };
    expect(list.data).toContainEqual(expect.objectContaining({ id: created.id }));
    expect(list.data[0]).not.toHaveProperty('token');

    const meResponse = await app.request('/api/v1/me', {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(meResponse.status).toBe(200);
    expect(await meResponse.json()).toMatchObject({
      id: user.id,
      authentication: 'token',
      scopes: ['pages:read'],
    });

    const firstUsage = await testQuery<{ last_used_at: string }>(
      'select last_used_at::text from api_tokens where id = $1',
      [created.id],
    );
    const secondMeResponse = await app.request('/api/v1/me', {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(secondMeResponse.status).toBe(200);
    const secondUsage = await testQuery<{ last_used_at: string }>(
      'select last_used_at::text from api_tokens where id = $1',
      [created.id],
    );
    expect(secondUsage.rows[0]?.last_used_at).toBe(firstUsage.rows[0]?.last_used_at);
  });

  it('keeps read-only tokens from creating pages', async () => {
    const { app, token } = await createToken();
    const response = await app.request('/api/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Denied page' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'insufficient_scope' } });
  });

  it('lets comment-level tokens read but not edit pages', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const createdResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Comment access', scopes: ['pages:comment'] }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { token: string; scopes: string[] };
    expect(created.scopes).toEqual(['pages:comment']);

    const pagesResponse = await app.request('/api/v1/pages', {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(pagesResponse.status).toBe(200);

    const pageResponse = await app.request('/api/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Denied page' }),
    });
    expect(pageResponse.status).toBe(403);
    expect(await pageResponse.json()).toMatchObject({ error: { code: 'insufficient_scope' } });
  });

  it('allows write tokens to create an Untitled page with initial Markdown', async () => {
    const { app, token } = await createToken(['pages:write']);
    const response = await app.request('/api/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: 'Initial body.' }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ title: 'Untitled' });
    expect(body).not.toHaveProperty('ydoc');
  });

  it('rejects oversized page metadata before JSON parsing', async () => {
    const { app, token } = await createToken(['pages:read', 'pages:write']);
    const authorization = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const created = await app.request('/api/v1/pages', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ title: 'Limited page' }),
    });
    const page = (await created.json()) as { id: string };

    const response = await app.request(`/api/v1/pages/${page.id}`, {
      method: 'PATCH',
      headers: authorization,
      body: JSON.stringify({ title: 'x'.repeat(70 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });

  it('preserves PostgreSQL microseconds in page cursors', async () => {
    const { app, token, userId } = await createToken(['pages:read', 'pages:write']);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const older = await createTestPage(userId, { title: 'Older microsecond page' });
    const newer = await createTestPage(userId, { title: 'Newer microsecond page' });
    await testQuery(`update pages set updated_at = '2099-01-01 12:00:00.123456' where id = $1`, [
      older.id,
    ]);
    await testQuery(`update pages set updated_at = '2099-01-01 12:00:00.123789' where id = $1`, [
      newer.id,
    ]);

    const firstPage = await app.request('/api/v1/pages?limit=1', { headers });
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as {
      data: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(firstBody.data[0]?.id).toBe(newer.id);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const secondPage = await app.request(
      `/api/v1/pages?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? '')}`,
      { headers },
    );
    expect(secondPage.status).toBe(200);
    const secondBody = (await secondPage.json()) as { data: Array<{ id: string }> };
    expect(secondBody.data[0]?.id).toBe(older.id);
  });

  it('resolves exact titles with permission-aware server folder paths', async () => {
    const { app, token, userId } = await createToken(['pages:read', 'pages:write']);
    const parent = await createTestFolder(userId, { name: 'Parent' });
    const child = await createTestFolder(userId, { name: 'Child', parentId: parent.id });
    const otherUser = await createTestUser();
    await createTestPage(otherUser.id, { title: 'Plan' });
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    for (const parentId of [null, child.id]) {
      const created = await app.request('/api/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Plan', parentId }),
      });
      expect(created.status).toBe(201);
    }

    const response = await app.request('/api/v1/pages/resolve?title=plan', { headers });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ title: string; folderPath: string }> };
    expect(body.data).toEqual([
      expect.objectContaining({ title: 'Plan', folderPath: '/' }),
      expect.objectContaining({ title: 'Plan', folderPath: '/Parent/Child' }),
    ]);

    const emojiTitle = '😀'.repeat(200);
    const emojiPage = await app.request('/api/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: emojiTitle }),
    });
    expect(emojiPage.status).toBe(201);
    const emojiResolution = await app.request(
      `/api/v1/pages/resolve?title=${encodeURIComponent(emojiTitle)}`,
      { headers },
    );
    expect(emojiResolution.status).toBe(200);
    expect(await emojiResolution.json()).toMatchObject({
      data: [expect.objectContaining({ title: emojiTitle })],
    });
  });

  it('redacts inaccessible parent folder IDs from page and folder resources', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const editor = await createTestUser();
    const hiddenParent = await createTestFolder(owner.id, { name: 'Hidden parent' });
    const sharedChild = await createTestFolder(owner.id, {
      name: 'Shared child',
      parentId: hiddenParent.id,
    });
    const sharedPage = await createTestPage(owner.id, {
      title: 'Directly shared page',
      parentId: hiddenParent.id,
    });
    await testQuery(
      `insert into shares (entity_type, entity_id, recipient_user_id, permission)
       values ('folder', $1, $2, 'edit'), ('page', $3, $2, 'edit')`,
      [sharedChild.id, editor.id, sharedPage.id],
    );
    const token = await issueToken(app, editor.id, ['pages:read', 'pages:write']);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const folderResponse = await app.request('/api/v1/folders?limit=100', { headers });
    const folderBody = (await folderResponse.json()) as {
      data: Array<{ id: string; parentId: string | null }>;
    };
    expect(folderBody.data).toContainEqual(
      expect.objectContaining({ id: sharedChild.id, parentId: null }),
    );

    const getResponse = await app.request(`/api/v1/pages/${sharedPage.id}`, { headers });
    expect(await getResponse.json()).toMatchObject({ id: sharedPage.id, parentId: null });

    const listResponse = await app.request('/api/v1/pages?limit=100', { headers });
    const listBody = (await listResponse.json()) as {
      data: Array<{ id: string; parentId: string | null }>;
    };
    expect(listBody.data).toContainEqual(
      expect.objectContaining({ id: sharedPage.id, parentId: null }),
    );

    const hiddenParentFilterResponse = await app.request(
      `/api/v1/pages?parentId=${hiddenParent.id}`,
      { headers },
    );
    expect(hiddenParentFilterResponse.status).toBe(200);
    expect(await hiddenParentFilterResponse.json()).toMatchObject({ data: [] });

    const resolveResponse = await app.request(
      '/api/v1/pages/resolve?title=Directly%20shared%20page',
      {
        headers,
      },
    );
    const resolveBody = (await resolveResponse.json()) as {
      data: Array<{ id: string; parentId: string | null }>;
    };
    expect(resolveBody.data).toContainEqual(
      expect.objectContaining({ id: sharedPage.id, parentId: null }),
    );

    const updateResponse = await app.request(`/api/v1/pages/${sharedPage.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title: 'Updated shared page' }),
    });
    expect(await updateResponse.json()).toMatchObject({ id: sharedPage.id, parentId: null });
  });

  it('paginates folders with lossless cursors', async () => {
    const { app, token, userId } = await createToken();
    const older = await createTestFolder(userId, { name: 'Older folder' });
    const newer = await createTestFolder(userId, { name: 'Newer folder' });
    await testQuery(`update folders set updated_at = '2099-01-01 12:00:00.123456' where id = $1`, [
      older.id,
    ]);
    await testQuery(`update folders set updated_at = '2099-01-01 12:00:00.123789' where id = $1`, [
      newer.id,
    ]);
    const headers = { Authorization: `Bearer ${token}` };

    const firstResponse = await app.request('/api/v1/folders?limit=1', { headers });
    const first = (await firstResponse.json()) as {
      data: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(first.data[0]?.id).toBe(newer.id);
    expect(first.nextCursor).toEqual(expect.any(String));

    const secondResponse = await app.request(
      `/api/v1/folders?limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
      { headers },
    );
    const second = (await secondResponse.json()) as { data: Array<{ id: string }> };
    expect(second.data[0]?.id).toBe(older.id);
  });

  it('returns the effective inherited permission for a page created in a shared folder', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const editor = await createTestUser();
    const folder = await createTestFolder(owner.id, { name: 'Shared' });
    await testQuery(
      `insert into shares (entity_type, entity_id, recipient_user_id, permission)
       values ('folder', $1, $2, 'edit')`,
      [folder.id, editor.id],
    );
    const session = await createTestSession(editor.id);
    const tokenResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Shared-folder editor',
        scopes: ['pages:read', 'pages:write'],
      }),
    });
    const token = ((await tokenResponse.json()) as { token: string }).token;

    const response = await app.request('/api/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: folder.id, title: 'Collaborative page' }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      parentId: folder.id,
      ownerId: owner.id,
      permission: 'edit',
    });
  });

  it('revokes tokens through the browser session', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const createdResponse = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Temporary' }),
    });
    const created = (await createdResponse.json()) as { id: string; token: string };

    const revokeResponse = await app.request(`/api/v1/tokens/${created.id}`, {
      method: 'DELETE',
      headers: { Cookie: session.Cookie },
    });
    expect(revokeResponse.status).toBe(204);

    const meResponse = await app.request('/api/v1/me', {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(meResponse.status).toBe(401);
  });
});
