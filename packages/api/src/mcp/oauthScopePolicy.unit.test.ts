import { describe, expect, it, vi } from 'vitest';
import { createMcpOAuthScopePolicy, MCP_OAUTH_MAX_REQUEST_BODY_BYTES } from './oauthScopePolicy';

describe('MCP OAuth scope policy compatibility adapter', () => {
  it('delegates invalid authorize scopes to Better Auth with redirect validation intact', async () => {
    const authHandler = vi.fn(async (request: Request) => new Response(request.url));
    const policy = createMcpOAuthScopePolicy(authHandler);

    const response = await policy.authorize(
      new Request(
        'https://app.example.test/api/auth/oauth2/authorize?client_id=client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&response_type=code&scope=pages%3Awrite',
      ),
    );

    expect(response.status).toBe(200);
    const delegatedUrl = await response.text();
    expect(delegatedUrl).toContain('redirect_uri=https%3A%2F%2Fclient.example%2Fcallback');
    expect(delegatedUrl).toContain('metakip%3Ainvalid-pages-scope-combination');
  });

  it('rejects invalid consent scopes without silently dropping the request', async () => {
    const authHandler = vi.fn(async () => new Response('unexpected'));
    const policy = createMcpOAuthScopePolicy(authHandler);

    const response = await policy.consent(
      new Request('https://app.example.test/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'scope=pages%3Awrite',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_scope',
      error_description: 'pages:write requires pages:read',
    });
    expect(authHandler).not.toHaveBeenCalled();
  });

  it('applies the policy to authorize scopes supplied in the POST query', async () => {
    let delegatedRequest: Request | undefined;
    const authHandler = vi.fn(async (request: Request) => {
      delegatedRequest = request;
      return new Response('delegated');
    });
    const policy = createMcpOAuthScopePolicy(authHandler);

    const response = await policy.authorize(
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
    expect(new URL(delegatedRequest?.url ?? '').searchParams.get('scope')).toContain(
      'metakip:invalid-pages-scope-combination',
    );
    await expect(delegatedRequest?.text()).resolves.toContain(
      'metakip%3Ainvalid-pages-scope-combination',
    );
  });

  it('returns invalid_scope for a query-only invalid POST without a body encoding', async () => {
    const authHandler = vi.fn(async () => new Response('unexpected'));
    const policy = createMcpOAuthScopePolicy(authHandler);

    const response = await policy.authorize(
      new Request('https://app.example.test/api/auth/oauth2/authorize?scope=pages%3Awrite', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_scope',
      error_description: 'pages:write requires pages:read',
    });
    expect(authHandler).not.toHaveBeenCalled();
  });

  it.each([
    ['application/json', JSON.stringify({ scope: 'pages:write', padding: 'x'.repeat(70_000) })],
    ['application/x-www-form-urlencoded', `scope=pages%3Awrite&padding=${'x'.repeat(70_000)}`],
  ])('rejects oversized %s authorize bodies before delegation', async (contentType, body) => {
    const authHandler = vi.fn(async () => new Response('unexpected'));
    const policy = createMcpOAuthScopePolicy(authHandler);

    const response = await policy.authorize(
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
