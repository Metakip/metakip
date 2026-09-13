import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it, vi } from 'vitest';
import { v1ErrorResponse } from './v1Errors';

const logger = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@metakip/shared', () => ({ getApiLogger: () => logger }));

describe('v1ErrorResponse', () => {
  it('preserves the current ETag for recognized collaboration conflicts', async () => {
    const app = new Hono();
    app.onError((error, context) => v1ErrorResponse(context, error));
    app.get('/', () => {
      throw new HTTPException(409, {
        message: 'Page changed since it was read',
        cause: { code: 'COLLABORATION_CONFLICT', etag: '"current"' },
      });
    });

    const response = await app.request('/');
    expect(response.status).toBe(409);
    expect(response.headers.get('etag')).toBe('"current"');
    expect(await response.json()).toEqual({
      error: {
        code: 'COLLABORATION_CONFLICT',
        message: 'Page changed since it was read',
      },
    });
  });

  it('allows route body-limit middleware to own streamed payload errors', async () => {
    const app = new Hono();
    logger.error.mockClear();
    app.onError((error, context) => v1ErrorResponse(context, error));
    app.post(
      '/',
      bodyLimit({
        maxSize: 4,
        onError: (c) => c.json({ error: { code: 'payload_too_large' } }, 413),
      }),
      async (c) => c.text(await c.req.text()),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('too large'));
        controller.close();
      },
    });
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Transfer-Encoding': 'chunked' },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const response = await app.request(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { code: 'payload_too_large' } });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('exposes stable idempotency codes and retry timing', async () => {
    const app = new Hono();
    app.get('/', (c) =>
      v1ErrorResponse(
        c,
        new HTTPException(409, {
          message: 'Still running',
          cause: { code: 'idempotency_in_progress', retryAfterSeconds: 1 },
        }),
      ),
    );

    const response = await app.request('/');
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toEqual({
      error: { code: 'idempotency_in_progress', message: 'Still running' },
    });
  });
});
