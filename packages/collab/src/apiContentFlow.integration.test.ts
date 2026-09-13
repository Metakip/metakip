import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Logger } from '@logtape/logtape';
import { INTERNAL_CONTENT_HEADERS } from '@metakip/shared';
import { yDocToMarkdown } from '@metakip/shared/yjs-helpers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollabServer } from './server';
import { createTestSession, createTestUser, getTestPool } from './test-utils';

const pool = getTestPool();
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;
const internalSecret = 'test-collaboration-internal-secret';

function createToken() {
  const id = randomUUID();
  const token = `mdn_${id.replaceAll('-', '')}_${randomBytes(32).toString('base64url')}`;
  return { id, token, hash: createHash('sha256').update(token).digest('hex') };
}

describe('API content collaboration flow', () => {
  let server: ReturnType<typeof createCollabServer>;
  let port: number;
  const previousInternalUrl = process.env.COLLAB_INTERNAL_URL;
  const previousInternalSecret = process.env.COLLAB_INTERNAL_SECRET;

  beforeAll(async () => {
    server = createCollabServer({
      port: 0,
      pool,
      logger,
      debounceMs: 25,
      maxDebounceMs: 50,
      permissionRevalidationMs: 0,
      internalSecret,
    });
    await server.listen();
    port = (server as unknown as { address: { port: number } }).address.port;
    process.env.COLLAB_INTERNAL_URL = `http://localhost:${port}`;
    process.env.COLLAB_INTERNAL_SECRET = internalSecret;
  });

  afterAll(async () => {
    if (previousInternalUrl === undefined) delete process.env.COLLAB_INTERNAL_URL;
    else process.env.COLLAB_INTERNAL_URL = previousInternalUrl;
    if (previousInternalSecret === undefined) delete process.env.COLLAB_INTERNAL_SECRET;
    else process.env.COLLAB_INTERNAL_SECRET = previousInternalSecret;
    await server.destroy();
    await pool.end();
  });

  it('persists and broadcasts a v1 route replacement before responding', async () => {
    const user = await createTestUser(pool);
    const browserSession = await createTestSession(pool, user.id);
    const credential = createToken();
    await pool.query(
      `insert into api_tokens (id, user_id, name, token_hash, scopes)
       values ($1, $2, 'Integration token', $3, array['pages:read', 'pages:write'])`,
      [credential.id, user.id, credential.hash],
    );
    const apiModuleUrl = new URL('../../api/src/app.ts', import.meta.url).href;
    const apiModule = (await import(apiModuleUrl)) as {
      createApp(): Promise<{ request(path: string, init?: RequestInit): Promise<Response> }>;
    };
    const app = await apiModule.createApp();
    const authorization = { Authorization: `Bearer ${credential.token}` };
    const emptyCreatedResponse = await app.request('/api/v1/pages', {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Empty page' }),
    });
    const emptyPage = (await emptyCreatedResponse.json()) as { id: string };
    const emptyContentResponse = await app.request(`/api/v1/pages/${emptyPage.id}/content`, {
      headers: authorization,
    });
    expect(emptyContentResponse.status).toBe(200);
    expect(await emptyContentResponse.text()).toBe('');

    const createdResponse = await app.request('/api/v1/pages', {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Integrated page', markdown: 'Before.' }),
    });
    expect(createdResponse.status).toBe(201);
    const page = (await createdResponse.json()) as { id: string };

    const browserDocument = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: browserDocument,
      token: browserSession.token,
    });
    await new Promise<void>((resolve) => {
      if (provider.synced) resolve();
      else provider.on('synced', () => resolve());
    });

    const contentResponse = await app.request(`/api/v1/pages/${page.id}/content`, {
      headers: authorization,
    });
    expect(contentResponse.status).toBe(200);
    const replaceResponse = await app.request(`/api/v1/pages/${page.id}/content`, {
      method: 'PUT',
      headers: {
        ...authorization,
        'Content-Type': 'text/markdown',
        'If-Match': contentResponse.headers.get('etag') ?? '',
      },
      body: `---
icon: pin
tags:
  - integrated
releases:
  - version: "1.0"
    channels: [stable, preview]
details:
  owner:
    name: Agent
---

After.`,
    });
    expect(replaceResponse.status).toBe(204);
    const replacedContentResponse = await app.request(`/api/v1/pages/${page.id}/content`, {
      headers: authorization,
    });
    expect(replaceResponse.headers.get('etag')).toBe(replacedContentResponse.headers.get('etag'));
    const staleReplacementResponse = await app.request(`/api/v1/pages/${page.id}/content`, {
      method: 'PUT',
      headers: {
        ...authorization,
        'Content-Type': 'text/markdown',
        'If-Match': contentResponse.headers.get('etag') ?? '',
      },
      body: 'Stale replacement.',
    });
    expect(staleReplacementResponse.status).toBe(409);
    await vi.waitFor(() =>
      expect(yDocToMarkdown(Y.encodeStateAsUpdate(browserDocument))).toContain('After.'),
    );

    const idempotencyKey = `integration-${randomUUID()}`;
    const editBody = JSON.stringify({
      edits: [{ id: 'finish', oldText: 'After.', newText: 'Final.' }],
    });
    const originalFetch = globalThis.fetch;
    let dropMutationResponse = true;
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/apply-exact-edits')) {
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBeNull();
        expect(headers.get(INTERNAL_CONTENT_HEADERS.userId)).toBe(user.id);
        expect(headers.get(INTERNAL_CONTENT_HEADERS.tokenId)).toBe(credential.id);
      }
      const response = await originalFetch(input, init);
      if (dropMutationResponse && String(input).endsWith('/apply-exact-edits')) {
        dropMutationResponse = false;
        throw new TypeError('simulated response loss after collaboration commit');
      }
      return response;
    });
    try {
      const editResponse = await app.request(`/api/v1/pages/${page.id}/edits`, {
        method: 'POST',
        headers: {
          ...authorization,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: editBody,
      });
      expect(editResponse.status).toBe(503);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
    const replayResponse = await app.request(`/api/v1/pages/${page.id}/edits`, {
      method: 'POST',
      headers: {
        ...authorization,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: editBody,
    });
    expect(replayResponse.status).toBe(200);
    const replay = (await replayResponse.json()) as {
      etag: string;
      results: Array<{ id: string; status: string }>;
    };
    expect(replay).toMatchObject({
      results: [{ id: 'finish', status: 'applied' }],
    });
    const editedContentResponse = await app.request(`/api/v1/pages/${page.id}/content`, {
      headers: authorization,
    });
    expect(replay.etag).toBe(editedContentResponse.headers.get('etag'));
    await vi.waitFor(() =>
      expect(yDocToMarkdown(Y.encodeStateAsUpdate(browserDocument))).toContain('Final.'),
    );

    const conflictKey = `conflict-${randomUUID()}`;
    const conflictBody = JSON.stringify({
      edits: [{ id: 'missing', oldText: 'Text that is not present', newText: 'No-op' }],
    });
    const conflictResponse = await app.request(`/api/v1/pages/${page.id}/edits`, {
      method: 'POST',
      headers: {
        ...authorization,
        'Content-Type': 'application/json',
        'Idempotency-Key': conflictKey,
      },
      body: conflictBody,
    });
    expect(conflictResponse.status).toBe(200);
    const conflict = await conflictResponse.json();
    expect(conflict).toMatchObject({
      results: [{ id: 'missing', status: 'conflict', reason: 'old_text_not_found' }],
    });
    const conflictReplay = await app.request(`/api/v1/pages/${page.id}/edits`, {
      method: 'POST',
      headers: {
        ...authorization,
        'Content-Type': 'application/json',
        'Idempotency-Key': conflictKey,
      },
      body: conflictBody,
    });
    expect(await conflictReplay.json()).toEqual(conflict);

    const persisted = await pool.query<{
      properties: unknown;
      icon: string | null;
      ydoc: Buffer;
    }>('select properties, icon, ydoc from pages where id = $1', [page.id]);
    expect(persisted.rows[0]).toMatchObject({
      properties: {
        tags: ['integrated'],
        releases: [{ version: '1.0', channels: ['stable', 'preview'] }],
        details: { owner: { name: 'Agent' } },
      },
      icon: 'pin',
    });
    const persistedUpdate = persisted.rows[0]?.ydoc;
    if (!persistedUpdate) throw new Error('Persisted Yjs document is missing');
    expect(yDocToMarkdown(new Uint8Array(persistedUpdate))).toContain('Final.');
    const audit = await pool.query<{ count: string }>(
      `select count(*)::text as count from api_token_audit_events
       where token_id = $1 and page_id = $2 and operation = 'page.content.replace'
         and result = 'success'`,
      [credential.id, page.id],
    );
    expect(audit.rows[0]?.count).toBe('1');
    const replacementConflictAudit = await pool.query<{ count: string }>(
      `select count(*)::text as count from api_token_audit_events
       where token_id = $1 and page_id = $2 and operation = 'page.content.replace'
         and result = 'conflict'`,
      [credential.id, page.id],
    );
    expect(replacementConflictAudit.rows[0]?.count).toBe('1');
    const editAudit = await pool.query<{ count: string }>(
      `select count(*)::text as count from api_token_audit_events
       where token_id = $1 and page_id = $2 and operation = 'page.content.edit'
         and result = 'success'`,
      [credential.id, page.id],
    );
    expect(editAudit.rows[0]?.count).toBe('1');
    const conflictAudit = await pool.query<{ count: string }>(
      `select count(*)::text as count from api_token_audit_events
       where token_id = $1 and page_id = $2 and operation = 'page.content.edit'
         and result = 'conflict'`,
      [credential.id, page.id],
    );
    expect(conflictAudit.rows[0]?.count).toBe('1');

    provider.destroy();
    browserDocument.destroy();
  });
});
