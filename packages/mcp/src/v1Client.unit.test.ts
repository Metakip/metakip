import {
  hashMcpAccessToken,
  verifyMcpInternalCredential,
} from '@metakip/shared/node/mcp-internal-auth';
import { describe, expect, it, vi } from 'vitest';
import type { McpActor } from './types';
import { V1Client } from './v1Client';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const apiInternalSecret = 'test-mcp-api-internal-secret-0123456789';
const actor: McpActor = {
  authContext: {
    userId: '00000000-0000-4000-8000-000000000001',
    connectionId: 'session:session-1:client:client-1:user:user-1',
    clientId: 'client-1',
    sessionId: 'session-1',
    accessTokenHash: hashMcpAccessToken('oauth-token'),
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3_600,
    offlineAccess: false,
    scopes: ['pages:read', 'pages:write'],
  },
  apiInternalSecret,
};

describe('V1Client idempotency', () => {
  it('sends only the private MCP context credential to the API', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: [], nextCursor: null }));
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    expect(client.canWrite).toBe(true);
    await client.listPages({});

    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    const credential = headers.get('X-Metakip-MCP-Authorization');
    expect(credential).not.toBeNull();
    expect(verifyMcpInternalCredential(credential ?? '', apiInternalSecret)).toMatchObject(
      actor.authContext,
    );
    expect(headers.get('Authorization')).toBeNull();
  });

  it('generates a fresh private credential for every API request', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ data: [], nextCursor: null }));
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });
    const initialTime = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime);

    try {
      await client.listPages({});
      now.mockReturnValue(initialTime + 1_000);
      await client.listPages({});
    } finally {
      now.mockRestore();
    }

    const firstHeaders = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    const secondHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(firstHeaders.get('X-Metakip-MCP-Authorization')).not.toBe(
      secondHeaders.get('X-Metakip-MCP-Authorization'),
    );
  });

  it('forwards cancellation signals to API requests', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
          once: true,
        });
      });
    });
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });
    const request = client.createPage({ title: 'Cancelled' }, { signal: controller.signal });

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('only sends parentId when list_pages receives one', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ data: [], nextCursor: null }));
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await client.listPages({});
    await client.listPages({
      parentId: '00000000-0000-4000-8000-000000000002',
    });

    expect(new URL(fetcher.mock.calls[0]?.[0]?.toString() ?? '').search).toBe('');
    expect(new URL(fetcher.mock.calls[1]?.[0]?.toString() ?? '').searchParams.get('parentId')).toBe(
      '00000000-0000-4000-8000-000000000002',
    );
  });

  it('uses existing single-item Trash lifecycle endpoints', async () => {
    const pageId = '00000000-0000-4000-8000-000000000002';
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input.toString());
      if (url.pathname === '/api/v1/trash/pages') {
        return jsonResponse([{ id: pageId, title: 'first', icon: null, deletedAt: null }]);
      }
      if (url.pathname === '/api/v1/trash/folders') {
        throw new Error('Folder Trash should not be requested for a page operation');
      }
      expect(url.pathname).toBe(`/api/v1/pages/${pageId}/restore`);
      expect(init?.method).toBe('PATCH');
      return jsonResponse({ id: pageId });
    });
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await expect(client.restoreTrash('page', ['first', 'second'])).resolves.toEqual({
      items: [
        { reference: 'first', id: pageId, status: 'success' },
        {
          reference: 'second',
          status: 'failed',
          code: 'not_found',
          message: 'No trashed page "second"',
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('starts page and folder Trash requests before awaiting either response', async () => {
    const started: string[] = [];
    let resolvePages: (response: Response) => void = () => undefined;
    const pageResponse = new Promise<Response>((resolve) => {
      resolvePages = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const pathname = new URL(input.toString()).pathname;
      started.push(pathname);
      if (pathname === '/api/v1/trash/pages') return pageResponse;
      return jsonResponse([]);
    });
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    const request = client.listTrashed();
    expect(started).toEqual(['/api/v1/trash/pages', '/api/v1/trash/folders']);

    resolvePages(jsonResponse([]));
    await expect(request).resolves.toEqual({ items: [] });
  });

  it('uses the stable key as the fallback operation ID on retries', async () => {
    let operationBody: unknown;
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input.toString());
      if (url.pathname === '/api/v1/pages/resolve') {
        return jsonResponse({
          data: [
            {
              id: '00000000-0000-4000-8000-000000000002',
              parentId: null,
              title: 'Page',
              icon: null,
              cover: null,
              ownerId: actor.authContext.userId,
              permission: 'edit',
              properties: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              deletedAt: null,
              folderPath: '/',
            },
          ],
        });
      }
      if (url.pathname.endsWith('/content-operations')) {
        if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
        operationBody = JSON.parse(init.body) as unknown;
        expect(new Headers(init.headers).get('Idempotency-Key')).toBe('stable-retry-key');
        return jsonResponse({ id: 'stable-retry-key', etag: 'etag-1' });
      }
      return new Response('Not found', { status: 404 });
    });
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await client.appendToPage('Page', {
      content: 'new content',
      idempotencyKey: 'stable-retry-key',
    });

    expect(operationBody).toEqual({
      id: 'stable-retry-key',
      operation: 'append',
      content: 'new content',
    });
  });

  it('reports non-idempotent mutation transport failures as uncertain', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('request timed out'));
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await expect(client.createPage({ title: 'Possibly created' })).rejects.toMatchObject({
      status: 503,
      code: 'outcome_uncertain',
    });
  });

  it('keeps upstream 5xx mutation responses outcome-uncertain', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'service_unavailable' } }), { status: 503 }),
      );
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await expect(client.createPage({ title: 'Possibly created' })).rejects.toMatchObject({
      status: 503,
      code: 'outcome_uncertain',
    });
  });

  it.each([
    null,
    [],
  ])('keeps valid JSON with an invalid 5xx error shape outcome-uncertain', async (body) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 503 }));
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await expect(client.createPage({ title: 'Possibly created' })).rejects.toMatchObject({
      status: 503,
      code: 'outcome_uncertain',
    });
  });

  it('preserves uncertainty when a mutation returns malformed JSON', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('not-json', { status: 200 }));
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await expect(client.createPage({ title: 'Possibly created' })).rejects.toMatchObject({
      status: 503,
      code: 'outcome_uncertain',
    });
  });

  it('keeps invalid idempotent mutation responses safe to retry', async () => {
    const pageId = '00000000-0000-4000-8000-000000000002';
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(input.toString()).pathname;
      if (path === `/api/v1/pages/${pageId}`) {
        return jsonResponse({
          id: pageId,
          parentId: null,
          title: 'Page',
          icon: null,
          cover: null,
          ownerId: actor.authContext.userId,
          permission: 'edit',
          properties: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deletedAt: null,
        });
      }
      return new Response('not-json', { status: 200 });
    });
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await expect(
      client.appendToPage(pageId, {
        content: 'Possibly appended',
        idempotencyKey: 'stable-retry-key',
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'invalid_upstream_response',
    });
  });

  it('cancels discarded lifecycle response bodies', async () => {
    let cancelled = false;
    const pageId = '00000000-0000-4000-8000-000000000002';
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === `/api/v1/pages/${pageId}`) {
        return jsonResponse({
          id: pageId,
          parentId: null,
          title: 'Page',
          icon: null,
          cover: null,
          ownerId: actor.authContext.userId,
          permission: 'edit',
          properties: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deletedAt: null,
        });
      }
      if (url.pathname === `/api/v1/pages/${pageId}/move`) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{}'));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 200 },
        );
      }
      return new Response('Not found', { status: 404 });
    });
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await expect(client.movePages([pageId], null)).resolves.toEqual({
      items: [{ reference: pageId, id: pageId, status: 'success' }],
    });
    expect(cancelled).toBe(true);
  });

  it('does not mark read-resolution failures as mutation uncertainty', async () => {
    const pageId = '00000000-0000-4000-8000-000000000003';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'service_unavailable', message: 'busy' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await expect(client.movePages([pageId], null)).resolves.toEqual({
      items: [
        {
          reference: pageId,
          status: 'failed',
          message: 'busy',
          code: 'service_unavailable',
        },
      ],
    });
  });

  it('translates API revocation failures into a clear authentication error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Unauthorized' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new V1Client({ baseUrl: 'http://api.example.test/api/v1', fetcher, actor });

    await expect(client.listPages({})).rejects.toMatchObject({
      status: 401,
      code: 'invalid_token',
      message: 'MCP access token is no longer valid',
    });
  });
});
