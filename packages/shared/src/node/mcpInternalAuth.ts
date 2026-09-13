import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ApiTokenScope } from '../utils/apiToken.js';
import { isApiTokenScope } from '../utils/apiToken.js';

export const MCP_INTERNAL_AUTH_HEADER = 'X-Metakip-MCP-Authorization';
const MCP_INTERNAL_AUTH_VERSION = 1;
const MCP_INTERNAL_AUTH_TTL_SECONDS = 300;
export const MCP_API_DEVELOPMENT_SECRET = 'development-only-mcp-api-secret-0123456789abcdef';

type McpInternalAuthBaseContext = {
  userId: string;
  connectionId: string;
  accessTokenHash: string;
  accessTokenExpiresAt: number;
  scopes: readonly ApiTokenScope[];
};

export type McpInternalAuthContext = McpInternalAuthBaseContext &
  (
    | {
        offlineAccess: false;
        clientId: string | null;
        sessionId: string;
      }
    | {
        offlineAccess: true;
        clientId: string;
        sessionId: string | null;
      }
  );

type SignedMcpInternalAuthContext = McpInternalAuthContext & {
  version: number;
  issuedAt: number;
  expiresAt: number;
};

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseMcpInternalAuthContext(value: unknown): McpInternalAuthContext {
  if (!isRecord(value)) throw new Error('MCP authentication context is not an object');
  const scopes = value.scopes;
  if (
    typeof value.userId !== 'string' ||
    value.userId.length === 0 ||
    typeof value.connectionId !== 'string' ||
    value.connectionId.length === 0 ||
    typeof value.accessTokenHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.accessTokenHash) ||
    typeof value.accessTokenExpiresAt !== 'number' ||
    !Number.isSafeInteger(value.accessTokenExpiresAt) ||
    typeof value.offlineAccess !== 'boolean' ||
    !Array.isArray(scopes) ||
    !scopes.every(isApiTokenScope)
  ) {
    throw new Error('MCP authentication context is invalid');
  }
  const common = {
    userId: value.userId,
    connectionId: value.connectionId,
    accessTokenHash: value.accessTokenHash,
    accessTokenExpiresAt: value.accessTokenExpiresAt,
    scopes,
  };
  if (value.offlineAccess) {
    if (
      typeof value.clientId !== 'string' ||
      value.clientId.length === 0 ||
      (value.sessionId !== null &&
        (typeof value.sessionId !== 'string' || value.sessionId.length === 0))
    ) {
      throw new Error('MCP authentication context is invalid');
    }
    return {
      ...common,
      offlineAccess: true,
      clientId: value.clientId,
      sessionId: value.sessionId,
    };
  }
  if (
    typeof value.sessionId !== 'string' ||
    value.sessionId.length === 0 ||
    (value.clientId !== null && (typeof value.clientId !== 'string' || value.clientId.length === 0))
  ) {
    throw new Error('MCP authentication context is invalid');
  }
  return {
    ...common,
    offlineAccess: false,
    clientId: value.clientId,
    sessionId: value.sessionId,
  };
}

export function mcpConnectionIdFromClaims(userId: string, claims: Record<string, unknown>): string {
  const clientId =
    typeof claims.client_id === 'string'
      ? claims.client_id
      : typeof claims.azp === 'string'
        ? claims.azp
        : null;
  const sessionId = claims.sid;
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return `session:${sessionId}:client:${clientId ?? 'unknown'}:user:${userId}`;
  }
  if (clientId) return `client:${clientId}:user:${userId}`;
  return `user:${userId}`;
}

export function createMcpInternalCredential(
  context: McpInternalAuthContext,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const payload: SignedMcpInternalAuthContext = {
    ...context,
    version: MCP_INTERNAL_AUTH_VERSION,
    scopes: [...new Set(context.scopes)],
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + MCP_INTERNAL_AUTH_TTL_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function hashMcpAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Invalid internal credentials are treated as an authentication failure at
 * the private API boundary. The parser therefore returns null rather than
 * exposing malformed header details to a caller.
 */
export function verifyMcpInternalCredential(
  credential: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): McpInternalAuthContext | null {
  try {
    const parts = credential.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, encodedSignature] = parts;
    if (!encodedPayload || !encodedSignature) return null;

    const expectedSignature = Buffer.from(signPayload(encodedPayload, secret), 'base64url');
    const actualSignature = Buffer.from(encodedSignature, 'base64url');
    if (
      expectedSignature.length !== actualSignature.length ||
      !timingSafeEqual(expectedSignature, actualSignature)
    ) {
      return null;
    }

    const parsed: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!isRecord(parsed)) return null;
    const value = parsed;
    if (
      value.version !== MCP_INTERNAL_AUTH_VERSION ||
      typeof value.issuedAt !== 'number' ||
      !Number.isSafeInteger(value.issuedAt) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= value.issuedAt ||
      value.issuedAt > nowSeconds + 5 ||
      value.expiresAt <= nowSeconds
    ) {
      return null;
    }
    const context = parseMcpInternalAuthContext(value);
    return context.accessTokenExpiresAt <= nowSeconds ? null : context;
  } catch {
    return null;
  }
}

export function requireMcpApiInternalSecret(
  secret: string | undefined,
  isProduction = false,
): string {
  if (!secret) throw new Error('MCP_API_INTERNAL_SECRET is required');
  if (secret.length < 32) {
    throw new Error('MCP_API_INTERNAL_SECRET must be at least 32 characters');
  }
  if (isProduction && secret === MCP_API_DEVELOPMENT_SECRET) {
    throw new Error('MCP_API_INTERNAL_SECRET must not use the development value in production');
  }
  return secret;
}
