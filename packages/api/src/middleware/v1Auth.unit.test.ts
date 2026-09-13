import {
  createMcpInternalCredential,
  hashMcpAccessToken,
  type McpInternalAuthContext,
} from '@metakip/shared/node/mcp-internal-auth';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock('../auth', () => ({ auth: { api: { getSession: getSessionMock } } }));
vi.mock('../db/query', () => ({ executeQuery: vi.fn(), query: queryMock }));

import { requireV1Auth, requireV1Scope } from './v1Auth';

function createTestApp(requiredScope?: 'pages:read' | 'pages:write'): Hono {
  const app = new Hono();
  app.use('*', requireV1Auth);
  if (requiredScope) app.use('*', requireV1Scope(requiredScope));
  app.get('/test', (c) => c.json({ kind: c.get('v1Principal').kind }));
  return app;
}

function mcpCredential(scopes: ('pages:read' | 'pages:write')[]): string {
  return createMcpInternalCredential(
    {
      userId: 'user-1',
      connectionId: 'connection-1',
      clientId: null,
      sessionId: 'session-1',
      accessTokenHash: hashMcpAccessToken('oauth-token'),
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 60,
      offlineAccess: false,
      scopes,
    },
    'a'.repeat(32),
  );
}

describe('v1 authentication boundaries', () => {
  beforeEach(() => {
    queryMock.mockReset();
    getSessionMock.mockReset();
    vi.stubEnv('MCP_API_INTERNAL_SECRET', 'a'.repeat(32));
  });

  it('does not accept an OAuth bearer token as an API credential', async () => {
    const response = await createTestApp().request('/test', {
      headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.token.signature' },
    });

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts only a signed private MCP context', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'session-1' }] });
    const accessToken = 'oauth-token';
    const credential = createMcpInternalCredential(
      {
        userId: 'user-1',
        connectionId: 'connection-1',
        clientId: null,
        sessionId: 'session-1',
        accessTokenHash: hashMcpAccessToken(accessToken),
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 60,
        offlineAccess: false,
        scopes: ['pages:read'],
      },
      'a'.repeat(32),
    );

    const response = await createTestApp().request('/test', {
      headers: { 'X-Metakip-MCP-Authorization': credential },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: 'mcp' });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an online context without session identity', async () => {
    const credential = createMcpInternalCredential(
      {
        userId: 'user-1',
        connectionId: 'connection-1',
        clientId: null,
        sessionId: null,
        accessTokenHash: hashMcpAccessToken('oauth-token'),
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 60,
        offlineAccess: false,
        scopes: ['pages:read'],
      } as unknown as McpInternalAuthContext,
      'a'.repeat(32),
    );

    const response = await createTestApp().request('/test', {
      headers: { 'X-Metakip-MCP-Authorization': credential },
    });

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects an online context after its session is gone', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    const response = await createTestApp().request('/test', {
      headers: { 'X-Metakip-MCP-Authorization': mcpCredential(['pages:read']) },
    });

    expect(response.status).toBe(401);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('rejects offline contexts without refresh-grant identity', async () => {
    const credential = createMcpInternalCredential(
      {
        userId: 'user-1',
        connectionId: 'connection-1',
        clientId: null,
        sessionId: null,
        accessTokenHash: hashMcpAccessToken('oauth-token'),
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 60,
        offlineAccess: true,
        scopes: ['pages:read'],
      } as unknown as McpInternalAuthContext,
      'a'.repeat(32),
    );

    const response = await createTestApp().request('/test', {
      headers: { 'X-Metakip-MCP-Authorization': credential },
    });

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts an offline context after its browser session is gone', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'refresh-token-1' }] });
    const credential = createMcpInternalCredential(
      {
        userId: 'user-1',
        connectionId: 'connection-1',
        clientId: 'client-1',
        sessionId: 'expired-session',
        accessTokenHash: hashMcpAccessToken('offline-oauth-token'),
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 60,
        offlineAccess: true,
        scopes: ['pages:read'],
      },
      'a'.repeat(32),
    );

    const response = await createTestApp().request('/test', {
      headers: { 'X-Metakip-MCP-Authorization': credential },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ kind: 'mcp' });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('enforces MCP operation scopes at the V1 API boundary', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'session-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'session-1' }] });

    const readOnlyResponse = await createTestApp('pages:write').request('/test', {
      headers: { 'X-Metakip-MCP-Authorization': mcpCredential(['pages:read']) },
    });

    expect(readOnlyResponse.status).toBe(403);
    await expect(readOnlyResponse.json()).resolves.toEqual({
      error: { code: 'insufficient_scope', message: 'Token requires pages:write' },
    });

    const writableResponse = await createTestApp('pages:write').request('/test', {
      headers: {
        'X-Metakip-MCP-Authorization': mcpCredential(['pages:read', 'pages:write']),
      },
    });

    expect(writableResponse.status).toBe(200);
    await expect(writableResponse.json()).resolves.toEqual({ kind: 'mcp' });
  });
});
