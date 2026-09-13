import { createMcpProtectedRequestHandler } from '@better-auth/mcp';
import {
  hashMcpAccessToken,
  type McpInternalAuthContext,
  mcpConnectionIdFromClaims,
  parseMcpInternalAuthContext,
} from '@metakip/shared/node/mcp-internal-auth';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE, type McpActor, type McpScope } from './types';

type VerifiedMcpClaims = {
  sub?: unknown;
  scope?: unknown;
  exp?: unknown;
  client_id?: unknown;
  azp?: unknown;
  sid?: unknown;
};

class InvalidMcpTokenContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMcpTokenContextError';
  }
}

export type McpAuthOptions = {
  authIssuer: string;
  authJwksUrl: string;
  publicUrl: URL;
  resource: string;
};

function bearerFromRequest(request: Request): string | null {
  return (
    request.headers
      .get('authorization')
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ?? null
  );
}

function bearerOnlyRejection(request: Request, publicUrl: URL): Response | null {
  const authorization = request.headers.get('authorization');
  const hasDpopProof = request.headers.has('dpop');
  if (!hasDpopProof && (authorization === null || /^Bearer\s+\S+$/i.test(authorization))) {
    return null;
  }
  const resourceMetadata = new URL(
    '/.well-known/oauth-protected-resource/mcp',
    publicUrl,
  ).toString();
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'MCP requires Bearer authorization' },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadata}"`,
      },
    },
  );
}

function invalidTokenRejection(publicUrl: URL): Response {
  const resourceMetadata = new URL(
    '/.well-known/oauth-protected-resource/mcp',
    publicUrl,
  ).toString();
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'MCP access token is invalid' },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${resourceMetadata}"`,
      },
    },
  );
}

function contextFromClaims(token: string, claims: VerifiedMcpClaims): McpInternalAuthContext {
  const userId = claims.sub;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new InvalidMcpTokenContextError('MCP access token has no subject');
  }
  const scopeClaim = claims.scope;
  if (typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp)) {
    throw new InvalidMcpTokenContextError('MCP access token has no safe expiry');
  }
  const scopes: McpScope[] =
    typeof scopeClaim === 'string'
      ? scopeClaim
          .split(' ')
          .filter(
            (scope): scope is McpScope => scope === MCP_READ_SCOPE || scope === MCP_WRITE_SCOPE,
          )
      : [];
  const clientId =
    typeof claims.client_id === 'string'
      ? claims.client_id
      : typeof claims.azp === 'string'
        ? claims.azp
        : null;
  const sessionId = typeof claims.sid === 'string' ? claims.sid : null;
  const offlineAccess =
    typeof scopeClaim === 'string' && scopeClaim.split(' ').includes('offline_access');
  const common = {
    userId,
    connectionId: mcpConnectionIdFromClaims(userId, claims),
    accessTokenHash: hashMcpAccessToken(token),
    accessTokenExpiresAt: claims.exp,
    scopes: [...new Set(scopes)],
  };
  if (offlineAccess) {
    if (clientId === null) {
      throw new InvalidMcpTokenContextError('MCP offline token has no client identity');
    }
    return { ...common, offlineAccess: true, clientId, sessionId };
  }
  if (sessionId === null || sessionId.length === 0) {
    throw new InvalidMcpTokenContextError('MCP online token has no session identity');
  }
  return { ...common, offlineAccess: false, clientId, sessionId };
}

export function actorFromAuthInfo(authInfo: {
  apiInternalSecret: string;
  extra?: Record<string, unknown>;
}): McpActor {
  const context = parseMcpInternalAuthContext(authInfo.extra?.context);
  return {
    authContext: context,
    apiInternalSecret: authInfo.apiInternalSecret,
  };
}

export function createMcpRequestAuthenticator(
  options: McpAuthOptions,
  mcpHandler: McpHttpHandler,
): (request: Request) => Promise<Response> {
  const protectedMcpRequest = createMcpProtectedRequestHandler(
    {
      issuer: options.authIssuer,
      audience: options.resource,
      jwksUrl: options.authJwksUrl,
      requiredScopes: [MCP_READ_SCOPE],
      challengeScopes: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
      dpop: { signingAlgorithms: [] },
    },
    async (request, claims) => {
      const token = bearerFromRequest(request);
      if (!token) throw new Error('MCP access token missing after verification');
      const context = contextFromClaims(token, claims);
      // The proxied V1 operation is the authoritative API authentication and
      // authorization boundary; do not issue a duplicate /api/v1/me request.
      return mcpHandler.fetch(request, {
        authInfo: {
          token,
          clientId: 'metakip-mcp-proxy',
          scopes: [...context.scopes],
          resource: new URL('/mcp', options.publicUrl),
          extra: { context },
        },
      });
    },
  );

  return async (request) => {
    const rejection = bearerOnlyRejection(request, options.publicUrl);
    if (rejection) return rejection;
    try {
      return await protectedMcpRequest(request);
    } catch (error) {
      if (error instanceof InvalidMcpTokenContextError) {
        return invalidTokenRejection(options.publicUrl);
      }
      throw error;
    }
  };
}
