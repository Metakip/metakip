import { hashMcpAccessToken } from '@metakip/shared/node/mcp-internal-auth';
import { describe, expect, it, vi } from 'vitest';
import type { McpActor, McpPage } from './types';
import { V1PageClient } from './v1ClientPages';
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
    scopes: ['pages:read', 'pages:write'],
  },
  apiInternalSecret: 'test-mcp-api-internal-secret-0123456789',
};

function page(updatedAt: string): McpPage {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    parentId: null,
    title: 'Updated title',
    icon: null,
    cover: null,
    properties: null,
    ownerId: actor.authContext.userId,
    permission: 'edit',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('V1PageClient', () => {
  it('searches page titles through the v1 search endpoint', async () => {
    const searchPage = { ...page('2026-01-01T00:00:00.000Z'), folderPath: '/Research' };
    const io = {
      send: vi.fn().mockResolvedValue(new Response(null)),
      readJson: vi.fn().mockResolvedValue({ data: [searchPage] }),
      readMutationJson: vi.fn(),
      readBytes: vi.fn(),
      readBinaryOrMarkdown: vi.fn(),
      discardResponse: vi.fn(),
    } as unknown as V1ClientIO;
    const client = new V1PageClient(io);

    await expect(client.searchPages(actor, 'project notes')).resolves.toEqual({
      data: [searchPage],
    });
    expect(io.send).toHaveBeenCalledWith(actor, '/pages/search?q=project+notes', {}, undefined);
  });

  it('returns fresh metadata after replacing page content', async () => {
    const initialPage = page('2026-01-01T00:00:00.000Z');
    const updatedPage = page('2026-01-01T00:01:00.000Z');
    const io = {
      send: vi
        .fn()
        .mockImplementation(async (_actor: McpActor, path: string, init?: { method?: string }) => {
          if (init?.method === 'PUT' || path.endsWith('/content')) {
            return new Response(null, { headers: { etag: 'etag-2' } });
          }
          return new Response(null);
        }),
      readJson: vi.fn().mockResolvedValueOnce(initialPage).mockResolvedValueOnce(updatedPage),
      readMutationJson: vi.fn(),
      readBytes: vi.fn(),
      readBinaryOrMarkdown: vi.fn(),
      discardResponse: vi.fn().mockResolvedValue(undefined),
    } as unknown as V1ClientIO;
    const client = new V1PageClient(io);

    await expect(client.replacePage(actor, initialPage.id, 'new markdown')).resolves.toMatchObject({
      page: { updatedAt: updatedPage.updatedAt },
      changed: true,
      etag: 'etag-2',
    });
    expect(io.send).toHaveBeenCalledTimes(4);
    expect(io.send).toHaveBeenLastCalledWith(actor, `/pages/${initialPage.id}`, {}, undefined);
  });
});
