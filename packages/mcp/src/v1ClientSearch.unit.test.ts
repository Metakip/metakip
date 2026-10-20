import { hashMcpAccessToken } from '@metakip/shared/node/mcp-internal-auth';
import { describe, expect, it, vi } from 'vitest';
import type { McpActor } from './types';
import { V1SearchClient } from './v1ClientSearch';
import type { V1ClientIO } from './v1ClientTransport';

const actor: McpActor = {
  authContext: {
    userId: '00000000-0000-4000-8000-000000000001',
    connectionId: 'session:session-1:client:client-1:user:user-1',
    clientId: 'client-1',
    sessionId: 'session-1',
    accessTokenHash: hashMcpAccessToken('oauth-token'),
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3_600,
    offlineAccess: false,
    scopes: ['pages:read'],
  },
  apiInternalSecret: 'test-mcp-api-internal-secret-0123456789',
};

describe('V1SearchClient', () => {
  it('returns mixed page and folder results from the standalone search endpoint', async () => {
    const page = {
      type: 'page',
      id: '00000000-0000-4000-8000-000000000002',
      parentId: null,
      title: 'Project Notes',
      icon: null,
      cover: null,
      properties: null,
      ownerId: actor.authContext.userId,
      permission: 'edit',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      folderPath: '/Research',
    };
    const folder = {
      type: 'folder',
      id: '00000000-0000-4000-8000-000000000003',
      parentId: null,
      name: 'Research',
      icon: null,
      ownerId: actor.authContext.userId,
      permission: 'edit',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      folderPath: '/Research',
    };
    const io = {
      send: vi.fn().mockResolvedValue(new Response(null)),
      readJson: vi.fn().mockResolvedValue({ data: [page, folder] }),
      readMutationJson: vi.fn(),
      readBytes: vi.fn(),
      readBinaryOrMarkdown: vi.fn(),
      discardResponse: vi.fn(),
    } as unknown as V1ClientIO;
    const client = new V1SearchClient(io);

    await expect(client.search(actor, 'project notes')).resolves.toEqual({ data: [page, folder] });
    expect(io.send).toHaveBeenCalledWith(actor, '/search?q=project+notes', {}, undefined);
  });
});
