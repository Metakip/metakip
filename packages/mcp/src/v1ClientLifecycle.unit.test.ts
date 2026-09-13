import { hashMcpAccessToken } from '@metakip/shared/node/mcp-internal-auth';
import { describe, expect, it } from 'vitest';
import type { McpActor, McpFolder, McpPage } from './types';
import { V1LifecycleClient } from './v1ClientLifecycle';
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

const page: McpPage = {
  id: '00000000-0000-4000-8000-000000000002',
  parentId: null,
  title: 'Page',
  icon: null,
  cover: null,
  properties: null,
  ownerId: actor.authContext.userId,
  permission: 'edit',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const folder: McpFolder = {
  id: '00000000-0000-4000-8000-000000000003',
  parentId: null,
  name: 'Folder',
  icon: null,
  ownerId: actor.authContext.userId,
  permission: 'edit',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function ioWithMutationTracker(onMutation: (path: string) => Promise<void>): V1ClientIO {
  return {
    send: async (_token, path) => {
      await onMutation(path);
      return new Response(null);
    },
    readJson: async () => null,
    readMutationJson: async <T>() => null as T,
    readBytes: async () => Buffer.alloc(0),
    readBinaryOrMarkdown: async () => '',
    discardResponse: async () => undefined,
  };
}

describe('V1LifecycleClient', () => {
  it('runs page mutations with bounded concurrency while preserving result order', async () => {
    let active = 0;
    let maximumActive = 0;
    const io = ioWithMutationTracker(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
    });
    const client = new V1LifecycleClient(
      io,
      async (_actor, reference) => ({ id: reference, page }),
      async (_actor, reference) => ({ id: reference, folder }),
      {
        listTrashed: async () => ({ items: [] }),
        resolveTrashReference: () => ({ id: folder.id }),
      },
    );

    const references = Array.from(
      { length: 12 },
      (_, index) => `00000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    );
    await expect(client.movePages(actor, references, null)).resolves.toMatchObject({
      items: references.map((reference) => ({ reference, id: reference, status: 'success' })),
    });
    expect(maximumActive).toBeLessThanOrEqual(8);
    expect(maximumActive).toBeGreaterThan(1);
  });

  it('parallelizes independent folder mutations', async () => {
    let active = 0;
    let maximumActive = 0;
    const io = ioWithMutationTracker(async (path) => {
      if (!path.startsWith('/folders/')) return;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
    });
    const client = new V1LifecycleClient(
      io,
      async (_actor, reference) => ({ id: reference, page }),
      async (_actor, reference) => ({ id: reference, folder: { ...folder, id: reference } }),
      {
        listTrashed: async () => ({ items: [] }),
        resolveTrashReference: () => ({ id: folder.id }),
      },
    );
    const references = [
      '00000000-0000-4000-8000-000000000012',
      '00000000-0000-4000-8000-000000000013',
      '00000000-0000-4000-8000-000000000014',
    ];

    await client.moveFolders(actor, references, null);

    expect(maximumActive).toBeGreaterThan(1);
  });

  it('does not mark copy requests as safe to retry', async () => {
    const requests: Array<{ path: string; idempotencyKey: string | null }> = [];
    const io: V1ClientIO = {
      send: async (_token, path, requestOptions) => {
        if (path.endsWith('/copy')) {
          requests.push({
            path,
            idempotencyKey: new Headers(requestOptions?.headers).get('Idempotency-Key'),
          });
        }
        return new Response(null, { status: 201 });
      },
      readJson: async () => null,
      readMutationJson: async <T>(_response: Response, parse: (value: unknown) => T) =>
        parse({ id: '00000000-0000-4000-8000-000000000020' }),
      readBytes: async () => Buffer.alloc(0),
      readBinaryOrMarkdown: async () => '',
      discardResponse: async () => undefined,
    };
    const client = new V1LifecycleClient(
      io,
      async (_actor, reference) => ({ id: reference, page }),
      async (_actor, reference) => ({ id: reference, folder }),
      {
        listTrashed: async () => ({ items: [] }),
        resolveTrashReference: () => ({ id: folder.id }),
      },
    );
    await client.copyPages(actor, ['00000000-0000-4000-8000-000000000021'], null);
    await client.copyFolders(actor, ['00000000-0000-4000-8000-000000000022'], null);

    expect(requests).toEqual([
      {
        path: '/pages/00000000-0000-4000-8000-000000000021/copy',
        idempotencyKey: null,
      },
      {
        path: '/folders/00000000-0000-4000-8000-000000000022/copy',
        idempotencyKey: null,
      },
    ]);
  });
});
