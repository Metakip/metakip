import { randomUUID } from 'node:crypto';
import { MAX_YDOC_BYTES } from '@metakip/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireCollaborationInternalSecret } from '../env';
import type { V1Principal } from '../middleware/v1Auth';
import { readPageMarkdown, replacePageMarkdown } from './collaborationContentClient';

describe('collaboration content client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects an invalid collaboration secret during startup validation', () => {
    vi.stubEnv('COLLAB_INTERNAL_SECRET', 'too-short');
    expect(() => requireCollaborationInternalSecret()).toThrow(
      'COLLAB_INTERNAL_SECRET must be at least 32 characters',
    );
  });

  it('sends Markdown raw and carries the revision through If-Match', async () => {
    vi.stubEnv('COLLAB_INTERNAL_URL', 'http://collaboration.test');
    vi.stubEnv('COLLAB_INTERNAL_SECRET', 'a'.repeat(32));
    const markdown = 'Quotes: "value"\nBackslash: \\path\nUnicode: 文';
    const etag = '"revision"';
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBe(markdown);
      expect(init?.headers).toMatchObject({
        'Content-Type': 'text/markdown; charset=utf-8',
        'If-Match': etag,
      });
      return new Response(JSON.stringify({ etag: '"next"' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const principal: V1Principal = {
      kind: 'session',
      userId: randomUUID(),
      credential: `session-${randomUUID()}`,
    };

    await expect(replacePageMarkdown(randomUUID(), principal, markdown, etag)).resolves.toEqual({
      etag: '"next"',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['ws://collaboration.test', 'http://collaboration.test'],
    ['wss://collaboration.test', 'https://collaboration.test'],
  ])('converts %s internal URLs to %s', async (configuredUrl, expectedUrl) => {
    vi.stubEnv('COLLAB_INTERNAL_URL', configuredUrl);
    vi.stubEnv('COLLAB_INTERNAL_SECRET', 'a'.repeat(32));
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ etag: '"next"' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const principal: V1Principal = {
      kind: 'session',
      userId: randomUUID(),
      credential: `session-${randomUUID()}`,
    };
    const pageId = randomUUID();

    await replacePageMarkdown(pageId, principal, 'Body', '"current"');

    expect(fetchMock).toHaveBeenCalledWith(
      `${expectedUrl}/internal/pages/${encodeURIComponent(pageId)}/replace-markdown`,
      expect.any(Object),
    );
  });

  it('reads near-limit Markdown without JSON escape expansion', async () => {
    vi.stubEnv('COLLAB_INTERNAL_URL', 'http://collaboration.test');
    vi.stubEnv('COLLAB_INTERNAL_SECRET', 'a'.repeat(32));
    const markdown = '\u0000'.repeat(MAX_YDOC_BYTES);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(markdown, {
            status: 200,
            headers: {
              'Content-Type': 'text/markdown; charset=utf-8',
              ETag: '"near-limit"',
            },
          }),
      ),
    );
    const principal: V1Principal = {
      kind: 'session',
      userId: randomUUID(),
      credential: `session-${randomUUID()}`,
    };

    const result = await readPageMarkdown(randomUUID(), principal);
    expect(result.etag).toBe('"near-limit"');
    expect(result.markdown).toHaveLength(MAX_YDOC_BYTES);
    expect(result.markdown.charCodeAt(MAX_YDOC_BYTES - 1)).toBe(0);
  });

  it('preserves recognized conflict details and the current ETag', async () => {
    vi.stubEnv('COLLAB_INTERNAL_URL', 'http://collaboration.test');
    vi.stubEnv('COLLAB_INTERNAL_SECRET', 'a'.repeat(32));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ message: 'Page changed since it was read', etag: '"new"' }),
            {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );
    const principal: V1Principal = {
      kind: 'session',
      userId: randomUUID(),
      credential: `session-${randomUUID()}`,
    };

    await expect(
      replacePageMarkdown(randomUUID(), principal, 'Body', '"old"'),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Page changed since it was read',
      cause: { code: 'COLLABORATION_CONFLICT', etag: '"new"' },
    });
  });

  it('replaces unexpected internal details with the public service message', async () => {
    vi.stubEnv('COLLAB_INTERNAL_URL', 'http://collaboration.test');
    vi.stubEnv('COLLAB_INTERNAL_SECRET', 'a'.repeat(32));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'password authentication failed for database' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const principal: V1Principal = {
      kind: 'session',
      userId: randomUUID(),
      credential: `session-${randomUUID()}`,
    };

    await expect(
      replacePageMarkdown(randomUUID(), principal, 'Body', '"old"'),
    ).rejects.toMatchObject({
      status: 503,
      message: 'Collaboration service is unavailable',
    });
  });

  it('rejects invalid UTF-8 collaboration responses', async () => {
    vi.stubEnv('COLLAB_INTERNAL_URL', 'http://collaboration.test');
    vi.stubEnv('COLLAB_INTERNAL_SECRET', 'a'.repeat(32));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x7d]))),
    );
    const principal: V1Principal = {
      kind: 'session',
      userId: randomUUID(),
      credential: `session-${randomUUID()}`,
    };

    await expect(
      replacePageMarkdown(randomUUID(), principal, 'Body', '"old"'),
    ).rejects.toMatchObject({
      status: 503,
      message: 'Collaboration service is unavailable',
    });
  });

  it('preserves stable collaboration backpressure details', async () => {
    vi.stubEnv('COLLAB_INTERNAL_URL', 'http://collaboration.test');
    vi.stubEnv('COLLAB_INTERNAL_SECRET', 'a'.repeat(32));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message: 'Collaboration command failed',
              code: 'collaboration_busy',
              retryAfterSeconds: 1,
            }),
            { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '1' } },
          ),
      ),
    );
    const principal: V1Principal = {
      kind: 'session',
      userId: randomUUID(),
      credential: `session-${randomUUID()}`,
    };

    await expect(
      replacePageMarkdown(randomUUID(), principal, 'Body', '"old"'),
    ).rejects.toMatchObject({
      status: 503,
      message: 'Collaboration service is unavailable',
      cause: { code: 'collaboration_busy', retryAfterSeconds: 1 },
    });
  });
});
