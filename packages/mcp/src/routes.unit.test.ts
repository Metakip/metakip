import { describe, expect, it, vi } from 'vitest';
import { createMcpApp } from './routes';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function options(fetcher: typeof fetch = fetch) {
  return {
    apiUrl: 'https://api.example.test',
    publicUrl: new URL('https://mcp.example.test'),
    authIssuer: 'https://auth.example.test/api/auth',
    authJwksUrl: 'https://auth.example.test/api/auth/jwks',
    apiInternalSecret: 'test-mcp-api-internal-secret-0123456789',
    fetcher,
  };
}

describe('MCP service routes', () => {
  it('uses Better Auth protected-resource challenges for unauthenticated requests', async () => {
    const app = createMcpApp(options());
    const response = await app.request('/mcp', { method: 'POST', body: '{}' });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
    );
    await expect(response.json()).resolves.toMatchObject({ jsonrpc: '2.0' });
  });

  it('rejects DPoP authorization because the MCP gateway is bearer-only', async () => {
    const app = createMcpApp(options());
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'DPoP access-token',
        DPoP: 'proof',
      },
      body: '{}',
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
    );
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'MCP requires Bearer authorization' },
      id: null,
    });
  });

  it('rejects oversized MCP messages before authentication or parsing', async () => {
    const app = createMcpApp(options());
    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Content-Length': String(32 * 1024 * 1024 + 1) },
      body: '{}',
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'payload_too_large', message: 'MCP request body is too large' },
    });
  });

  it('proxies Better Auth OAuth requests under the API auth path', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const app = createMcpApp(options(fetcher));

    const response = await app.request('/oauth2/token', {
      method: 'POST',
      body: 'grant_type=refresh_token',
    });

    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/api/auth/oauth2/token',
    );
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves local health routes ahead of the CORS middleware', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ status: 'ok' }));
    const app = createMcpApp(options(fetcher));

    const healthResponse = await app.request('/api/health');
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.headers.get('access-control-allow-origin')).toBeNull();

    const readinessResponse = await app.request('/api/ready');
    expect(readinessResponse.status).toBe(200);
    expect(fetcher.mock.calls[0]?.[0]).toEqual(new URL('https://api.example.test/api/health'));
  });

  it('proxies protected-resource metadata at the MCP origin', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const app = createMcpApp(options(fetcher));

    const response = await app.request('/.well-known/oauth-protected-resource/mcp');

    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      'https://api.example.test/.well-known/oauth-protected-resource/mcp',
    );
  });

  it('sanitizes upstream proxy failures at the public boundary', async () => {
    const app = createMcpApp(
      options(vi.fn<typeof fetch>().mockRejectedValue(new Error('connect ECONNREFUSED'))),
    );

    const response = await app.request('/oauth2/token', {
      method: 'POST',
      body: 'grant_type=authorization_code',
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'service_unavailable',
        message: 'Metakip API is temporarily unavailable',
      },
    });
  });
});
