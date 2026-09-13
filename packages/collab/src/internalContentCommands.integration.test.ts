import { randomUUID } from 'node:crypto';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Logger } from '@logtape/logtape';
import { INTERNAL_CONTENT_HEADERS, type ReadPageMarkdownCommandResponse } from '@metakip/shared';
import { replaceMarkdownBody } from '@metakip/shared/yjs-document-replacement';
import { yDocToMarkdown } from '@metakip/shared/yjs-helpers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollabServer } from './server';
import {
  createTestPage,
  createTestSession,
  createTestUser,
  createTestYjsDoc,
  getTestPool,
} from './test-utils';

const pool = getTestPool();
const logError = vi.fn();
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: logError,
  debug: vi.fn(),
} as unknown as Logger;
const internalSecret = 'test-collaboration-internal-secret';

function internalHeaders(userId: string): Record<string, string> {
  return {
    [INTERNAL_CONTENT_HEADERS.secret]: internalSecret,
    [INTERNAL_CONTENT_HEADERS.userId]: userId,
    [INTERNAL_CONTENT_HEADERS.requestId]: randomUUID(),
    [INTERNAL_CONTENT_HEADERS.idempotencyPrincipal]: `session:test-${userId}`,
  };
}

async function readMarkdownResponse(response: Response): Promise<ReadPageMarkdownCommandResponse> {
  const etag = response.headers.get('ETag');
  if (!etag) throw new Error('Read Markdown response is missing its ETag');
  return { markdown: await response.text(), etag };
}

describe('internal content commands', () => {
  let server: ReturnType<typeof createCollabServer>;
  let port: number;

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
  });

  afterAll(async () => {
    await server.destroy();
    await pool.end();
  });

  it('returns an empty Markdown string for an empty page', async () => {
    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id, 'Empty page');
    const response = await fetch(
      `http://localhost:${port}/internal/pages/${page.id}/read-markdown`,
      { method: 'POST', headers: internalHeaders(user.id) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(await readMarkdownResponse(response)).toMatchObject({
      markdown: '',
      etag: expect.any(String),
    });
  });

  it('broadcasts and durably persists an authenticated mutation with metadata', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id, 'Command page', createTestYjsDoc('Before'));
    const browserDocument = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: browserDocument,
      token: session.token,
    });
    await new Promise<void>((resolve) => {
      if (provider.synced) resolve();
      else provider.on('synced', () => resolve());
    });

    const readResponse = await fetch(
      `http://localhost:${port}/internal/pages/${page.id}/read-markdown`,
      {
        method: 'POST',
        headers: internalHeaders(user.id),
      },
    );
    expect(readResponse.status).toBe(200);
    const current = await readMarkdownResponse(readResponse);

    const mutationResponse = await fetch(
      `http://localhost:${port}/internal/pages/${page.id}/replace-markdown`,
      {
        method: 'POST',
        headers: {
          ...internalHeaders(user.id),
          'Content-Type': 'text/markdown; charset=utf-8',
          'If-Match': current.etag,
        },
        body: '---\nicon: pin\ntags:\n  - command\n---\n\nBefore after',
      },
    );
    expect(mutationResponse.status).toBe(200);
    await vi.waitFor(() =>
      expect(yDocToMarkdown(Y.encodeStateAsUpdate(browserDocument))).toContain('Before after'),
    );

    const persisted = await pool.query<{
      ydoc: Buffer;
      properties: Record<string, unknown>;
      icon: string;
    }>('select ydoc, properties, icon from pages where id = $1', [page.id]);
    const stored = persisted.rows[0];
    if (!stored) throw new Error('Persisted page is missing');
    const storedDocument = new Y.Doc();
    Y.applyUpdate(storedDocument, new Uint8Array(stored.ydoc));
    expect(yDocToMarkdown(Y.encodeStateAsUpdate(storedDocument))).toContain('Before after');
    expect(stored.properties).toEqual({ tags: ['command'] });
    expect(stored.icon).toBe('pin');

    replaceMarkdownBody(browserDocument, 'Command page', 'Browser write after command');
    await vi.waitFor(async () => {
      const afterBrowserWrite = await pool.query<{ ydoc: Buffer }>(
        'select ydoc from pages where id = $1',
        [page.id],
      );
      const storedYdoc = afterBrowserWrite.rows[0]?.ydoc;
      if (!storedYdoc) throw new Error('Persisted page is missing after browser write');
      const afterBrowserDocument = new Y.Doc();
      try {
        Y.applyUpdate(afterBrowserDocument, new Uint8Array(storedYdoc));
        expect(yDocToMarkdown(Y.encodeStateAsUpdate(afterBrowserDocument))).toContain(
          'Browser write after command',
        );
      } finally {
        afterBrowserDocument.destroy();
      }
    });

    provider.destroy();
    browserDocument.destroy();
    storedDocument.destroy();
  });

  it('rejects a replacement when page metadata changed after it was read', async () => {
    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id, 'Concurrent page', createTestYjsDoc('Before'));
    const readResponse = await fetch(
      `http://localhost:${port}/internal/pages/${page.id}/read-markdown`,
      {
        method: 'POST',
        headers: internalHeaders(user.id),
      },
    );
    const current = await readMarkdownResponse(readResponse);
    await pool.query('update pages set properties = $1 where id = $2', [
      JSON.stringify({ concurrent: true }),
      page.id,
    ]);

    const mutationResponse = await fetch(
      `http://localhost:${port}/internal/pages/${page.id}/replace-markdown`,
      {
        method: 'POST',
        headers: {
          ...internalHeaders(user.id),
          'Content-Type': 'text/markdown; charset=utf-8',
          'If-Match': current.etag,
        },
        body: 'Before after',
      },
    );
    expect(mutationResponse.status).toBe(409);

    const persisted = await pool.query<{ ydoc: Buffer; properties: Record<string, unknown> }>(
      'select ydoc, properties from pages where id = $1',
      [page.id],
    );
    const row = persisted.rows[0];
    if (!row) throw new Error('Persisted page is missing');
    const storedDocument = new Y.Doc();
    Y.applyUpdate(storedDocument, new Uint8Array(row.ydoc));
    expect(storedDocument.getText('content').toString()).toBe('Before');
    expect(row.properties).toEqual({ concurrent: true });
    storedDocument.destroy();
  });

  it('preserves conflict details and the current ETag', async () => {
    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id, 'Conflict page', createTestYjsDoc('Before'));
    const readResponse = await fetch(
      `http://localhost:${port}/internal/pages/${page.id}/read-markdown`,
      { method: 'POST', headers: internalHeaders(user.id) },
    );
    const current = await readMarkdownResponse(readResponse);

    const response = await fetch(
      `http://localhost:${port}/internal/pages/${page.id}/replace-markdown`,
      {
        method: 'POST',
        headers: {
          ...internalHeaders(user.id),
          'Content-Type': 'text/markdown; charset=utf-8',
          'If-Match': '"stale"',
        },
        body: 'After',
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: 'Page changed since it was read',
      etag: current.etag,
    });
  });

  it('rejects invalid UTF-8 in JSON commands without replacement decoding', async () => {
    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id, 'Invalid command');
    const response = await fetch(
      `http://localhost:${port}/internal/pages/${page.id}/apply-exact-edits`,
      {
        method: 'POST',
        headers: { ...internalHeaders(user.id), 'Content-Type': 'application/json' },
        body: new Uint8Array([0x7b, 0xff, 0x7d]),
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Command JSON must be valid UTF-8' });
  });

  it('logs unexpected details without returning them', async () => {
    const user = await createTestUser(pool);
    const querySpy = vi.spyOn(pool, 'query');
    querySpy.mockRejectedValueOnce(new Error('sensitive postgres connection detail'));
    logError.mockClear();

    const response = await fetch(
      `http://localhost:${port}/internal/pages/${randomUUID()}/read-markdown`,
      { method: 'POST', headers: internalHeaders(user.id) },
    );
    querySpy.mockRestore();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: 'Collaboration command failed' });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('sensitive postgres connection detail'),
    );
  });
});
