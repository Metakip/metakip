import { describe, expect, it, vi } from 'vitest';
import { createMcpOAuthRequestGuard, MCP_OAUTH_MAX_REQUEST_BODY_BYTES } from './oauthScopePolicy';

describe('MCP OAuth scope policy compatibility adapter', () => {
  it('delegates write-only authorize scopes to Better Auth', async () => {
    const authHandler = vi.fn(async (request: Request) => new Response(request.url));
    const guard = createMcpOAuthRequestGuard(authHandler);

    const response = await guard.authorize(
      new Request(
        'https://app.example.test/api/auth/oauth2/authorize?client_id=client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&response_type=code&scope=pages%3Awrite',
      ),
    );

    expect(response.status).toBe(200);
    const delegatedUrl = await response.text();
    expect(delegatedUrl).toContain('redirect_uri=https%3A%2F%2Fclient.example%2Fcallback');
    expect(delegatedUrl).toContain('scope=pages%3Awrite');
  });

  it('allows higher scopes without listing their implied lower scopes', async () => {
    const authHandler = vi.fn(async () => new Response('delegated'));
    const guard = createMcpOAuthRequestGuard(authHandler);

    const response = await guard.consent(
      new Request('https://app.example.test/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'scope=pages%3Awrite',
      }),
    );

    expect(response.status).toBe(200);
    expect(authHandler).toHaveBeenCalledOnce();
  });

  it('allows comment access without listing the implied read scope', async () => {
    const authHandler = vi.fn(async () => new Response('delegated'));
    const guard = createMcpOAuthRequestGuard(authHandler);

    const response = await guard.consent(
      new Request('https://app.example.test/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'scope=pages%3Acomment',
      }),
    );

    expect(response.status).toBe(200);
    expect(authHandler).toHaveBeenCalledTimes(1);
  });

  it('passes authorize scopes supplied in a POST query through unchanged', async () => {
    let delegatedRequest: Request | undefined;
    const authHandler = vi.fn(async (request: Request) => {
      delegatedRequest = request;
      return new Response('delegated');
    });
    const guard = createMcpOAuthRequestGuard(authHandler);

    const response = await guard.authorize(
      new Request(
        'https://app.example.test/api/auth/oauth2/authorize?client_id=client&scope=pages%3Awrite',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'response_type=code',
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(new URL(delegatedRequest?.url ?? '').searchParams.get('scope')).toBe('pages:write');
    await expect(delegatedRequest?.text()).resolves.toBe('response_type=code');
  });

  it('delegates query-only POST authorize requests without a body encoding', async () => {
    const authHandler = vi.fn(async () => new Response('delegated'));
    const guard = createMcpOAuthRequestGuard(authHandler);

    const response = await guard.authorize(
      new Request('https://app.example.test/api/auth/oauth2/authorize?scope=pages%3Awrite', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    expect(authHandler).toHaveBeenCalledOnce();
  });

  it.each([
    ['application/json', JSON.stringify({ scope: 'pages:write', padding: 'x'.repeat(70_000) })],
    ['application/x-www-form-urlencoded', `scope=pages%3Awrite&padding=${'x'.repeat(70_000)}`],
  ])('rejects oversized %s authorize bodies before delegation', async (contentType, body) => {
    const authHandler = vi.fn(async () => new Response('unexpected'));
    const guard = createMcpOAuthRequestGuard(authHandler);

    const response = await guard.authorize(
      new Request('https://app.example.test/api/auth/oauth2/authorize', {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      }),
    );

    expect(body.length).toBeGreaterThan(MCP_OAUTH_MAX_REQUEST_BODY_BYTES);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Request body is too large',
    });
    expect(authHandler).not.toHaveBeenCalled();
  });
});
