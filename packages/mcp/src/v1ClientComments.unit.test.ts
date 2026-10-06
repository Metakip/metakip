import { hashMcpAccessToken } from '@metakip/shared/node/mcp-internal-auth';
import { describe, expect, it, vi } from 'vitest';
import type { McpActor } from './types';
import { V1Client } from './v1Client';
import { V1CommentClient } from './v1ClientComments';
import type { V1ClientIO } from './v1ClientTransport';

const actor: McpActor = {
  authContext: {
    userId: '00000000-0000-4000-8000-000000000001',
    connectionId: 'session:session-1:client:client-1:user:user-1',
    clientId: 'client-1',
    sessionId: 'session-1',
    accessTokenHash: hashMcpAccessToken('comments-only-token'),
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3_600,
    offlineAccess: false,
    scopes: ['pages:comment'],
  },
  apiInternalSecret: 'test-mcp-api-internal-secret-0123456789',
};

describe('V1CommentClient', () => {
  it('grants read and comment capabilities without page editing', () => {
    const client = new V1Client({ actor, baseUrl: 'https://metakip.example.test' });

    expect(client.canReadPages).toBe(true);
    expect(client.canWrite).toBe(false);
    expect(client.canReadComments).toBe(true);
    expect(client.canWriteComments).toBe(true);
  });

  it('does not grant comment access to read-only scopes', () => {
    const readOnlyActor: McpActor = {
      ...actor,
      authContext: { ...actor.authContext, scopes: ['pages:read'] },
    };
    const client = new V1Client({ actor: readOnlyActor, baseUrl: 'https://metakip.example.test' });

    expect(client.canReadComments).toBe(false);
    expect(client.canWriteComments).toBe(false);
  });

  it('uses the page UUID directly for comment operations', async () => {
    const io = {
      send: vi.fn().mockResolvedValue(new Response(null)),
      readJson: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
      readMutationJson: vi.fn(),
      readBytes: vi.fn(),
      readBinaryOrMarkdown: vi.fn(),
      discardResponse: vi.fn(),
    } as unknown as V1ClientIO;
    const client = new V1CommentClient(io);
    const pageId = '00000000-0000-4000-8000-000000000002';

    await expect(client.listPageComments(actor, pageId, { status: 'all' })).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    expect(io.send).toHaveBeenCalledTimes(1);
    expect(io.send).toHaveBeenCalledWith(
      actor,
      `/pages/${pageId}/comments?status=all`,
      {},
      undefined,
    );
  });
});
