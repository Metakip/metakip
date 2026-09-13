import { APIError } from 'better-call';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authHandler = vi.hoisted(() => vi.fn<(request: Request) => Promise<Response>>());
const queryMock = vi.hoisted(() => vi.fn());
const verifyBearerTokenMock = vi.hoisted(() => vi.fn());

vi.mock('../auth', () => ({
  auth: { handler: authHandler },
}));
vi.mock('../db/query', () => ({ query: queryMock }));
vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: verifyBearerTokenMock }));

import { MCP_OAUTH_MAX_REQUEST_BODY_BYTES } from '../mcp/oauthScopePolicy';
import { authRoutes } from './auth';

describe('OAuth authorization routing', () => {
  beforeEach(() => {
    authHandler.mockReset();
    queryMock.mockReset();
    verifyBearerTokenMock.mockReset();
    authHandler.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://client.example/callback?error=invalid_scope' },
      }),
    );
  });

  it('routes login endpoints through the canonical authentication instance', async () => {
    await authRoutes.request('/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github' }),
    });

    expect(authHandler).toHaveBeenCalledTimes(1);
  });

  it('delegates invalid MCP scope combinations to Better Auth for its redirect', async () => {
    const response = await authRoutes.request(
      '/auth/oauth2/authorize?client_id=client-1&scope=pages%3Awrite&state=state-1',
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://client.example/callback?error=invalid_scope',
    );
    const delegatedRequest = authHandler.mock.calls[0]?.[0];
    expect(delegatedRequest).toBeInstanceOf(Request);
    expect(new URL(delegatedRequest?.url ?? '').searchParams.get('scope')).toContain(
      'metakip:invalid-pages-scope-combination',
    );
  });

  it('rewrites invalid form-encoded POST scopes before delegation', async () => {
    await authRoutes.request('/auth/oauth2/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'client_id=client-1&scope=pages%3Awrite',
    });

    const delegatedRequest = authHandler.mock.calls[0]?.[0];
    await expect(delegatedRequest?.text()).resolves.toContain(
      'metakip%3Ainvalid-pages-scope-combination',
    );
  });

  it('returns invalid_scope for a query-only invalid authorize POST', async () => {
    const response = await authRoutes.request(
      '/auth/oauth2/authorize?client_id=client-1&scope=pages%3Awrite',
      { method: 'POST' },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_scope',
      error_description: 'pages:write requires pages:read',
    });
    expect(authHandler).not.toHaveBeenCalled();
  });

  it.each([
    'application/json',
    'application/x-www-form-urlencoded',
  ])('rejects oversized OAuth %s bodies at the route boundary', async (contentType) => {
    const response = await authRoutes.request('/auth/oauth2/authorize', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: 'x'.repeat(MCP_OAUTH_MAX_REQUEST_BODY_BYTES + 1),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'Request body is too large',
    });
    expect(authHandler).not.toHaveBeenCalled();
  });

  it('records verified JWT revocations without forwarding the token to v1', async () => {
    const token = 'oauth.jwt.token';
    authHandler.mockResolvedValue(
      new Response(JSON.stringify({ error: 'unsupported_token_type' }), { status: 400 }),
    );
    verifyBearerTokenMock.mockResolvedValue({ exp: 2_000 });

    const response = await authRoutes.request('/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}&token_type_hint=access_token`,
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
    expect(verifyBearerTokenMock).toHaveBeenCalledWith(
      token,
      expect.objectContaining({ verifyOptions: expect.any(Object) }),
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('treats an unverifiable JWT revocation as a successful no-op', async () => {
    authHandler.mockResolvedValue(
      new Response(JSON.stringify({ error: 'unsupported_token_type' }), { status: 400 }),
    );
    verifyBearerTokenMock.mockRejectedValue(
      new APIError('UNAUTHORIZED', { message: 'token expired' }),
    );

    const response = await authRoutes.request('/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=expired.jwt.token&token_type_hint=access_token',
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('treats a verified JWT without a safe expiry as a successful no-op', async () => {
    authHandler.mockResolvedValue(
      new Response(JSON.stringify({ error: 'unsupported_token_type' }), { status: 400 }),
    );
    verifyBearerTokenMock.mockResolvedValue({});

    const response = await authRoutes.request('/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=invalid.jwt.token&token_type_hint=access_token',
    });

    expect(response.status).toBe(200);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('preserves an unexpected non-JSON Better Auth revocation response', async () => {
    authHandler.mockResolvedValue(new Response('invalid request', { status: 400 }));

    const response = await authRoutes.request('/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=invalid-token&token_type_hint=access_token',
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe('invalid request');
    expect(verifyBearerTokenMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns a controlled error when JWT verification is unavailable', async () => {
    authHandler.mockResolvedValue(
      new Response(JSON.stringify({ error: 'unsupported_token_type' }), { status: 400 }),
    );
    verifyBearerTokenMock.mockRejectedValue(new Error('JWKS unavailable'));

    const response = await authRoutes.request('/auth/oauth2/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=oauth.jwt.token&token_type_hint=access_token',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'temporarily_unavailable',
      error_description: 'Token revocation is temporarily unavailable',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
