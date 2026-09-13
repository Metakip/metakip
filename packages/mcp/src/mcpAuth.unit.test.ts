import type { McpInternalAuthContext } from '@metakip/shared/node/mcp-internal-auth';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

type VerifiedClaims = {
  sub?: unknown;
  scope?: unknown;
  exp?: unknown;
  client_id?: unknown;
  azp?: unknown;
  sid?: unknown;
};

type ProtectedCallback = (request: Request, claims: VerifiedClaims) => Promise<Response>;

const protectedCallback = vi.hoisted(() => vi.fn<ProtectedCallback>());
const protectedRequest = vi.hoisted(() => vi.fn<(request: Request) => Promise<Response>>());

vi.mock('@better-auth/mcp', () => ({
  createMcpProtectedRequestHandler: (_options: unknown, handler: ProtectedCallback) => {
    protectedCallback.mockImplementation(handler);
    return protectedRequest;
  },
}));

import { actorFromAuthInfo, createMcpRequestAuthenticator } from './mcpAuth';

const apiInternalSecret = 'test-mcp-api-internal-secret-0123456789';
const context: McpInternalAuthContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  connectionId: 'session:session-1:client:client-1:user:user-1',
  clientId: 'client-1',
  sessionId: 'session-1',
  accessTokenHash: 'a'.repeat(64),
  accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 60,
  offlineAccess: false,
  scopes: ['pages:read'],
};

describe('MCP authentication context', () => {
  it('binds the API actor to the verified MCP context', () => {
    const actor = actorFromAuthInfo({
      apiInternalSecret,
      extra: { context },
    });

    expect(actor).toMatchObject({
      authContext: context,
      apiInternalSecret,
    });
  });

  it('fails when the protected handler does not provide context', () => {
    expect(() => actorFromAuthInfo({ apiInternalSecret })).toThrow(
      'MCP authentication context is not an object',
    );
  });

  it('returns an invalid-token challenge for a verified token without session identity', async () => {
    protectedCallback.mockReset();
    protectedRequest.mockImplementation(async (request) => {
      return protectedCallback(request, {
        sub: 'user-1',
        scope: 'pages:read',
        exp: Math.floor(Date.now() / 1000) + 60,
        client_id: 'client-1',
      });
    });

    const authenticate = createMcpRequestAuthenticator(
      {
        authIssuer: 'https://auth.example.test/api/auth',
        authJwksUrl: 'https://auth.example.test/api/auth/jwks',
        publicUrl: new URL('https://mcp.example.test'),
        resource: 'https://mcp.example.test/mcp',
      },
      { fetch: async () => new Response(null) } as unknown as McpHttpHandler,
    );

    const response = await authenticate(
      new Request('https://mcp.example.test/mcp', {
        headers: { Authorization: 'Bearer valid-but-unsupported' },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
    );
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'MCP access token is invalid' },
      id: null,
    });
  });
});
