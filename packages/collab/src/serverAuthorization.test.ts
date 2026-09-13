import { createHash } from 'node:crypto';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Document, Server } from '@hocuspocus/server';
import { getStableColor } from '@metakip/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { encodeAwarenessMessage, encodeProtocolMessage } from './collabTestUtils';
import { createCollabServer } from './server';
import {
  createAuthenticatePayload,
  createConnectionConfig,
  createMockLogger,
  expectAuthenticationFailure,
  waitFor,
} from './serverTestHarness';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

describe('collab server authorization', () => {
  const pool = getTestPool();
  const logger = createMockLogger();
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger,
      permissionRevalidationMs: 0,
    });
    await server.listen();
    port = (server as unknown as { address: { port: number } }).address.port;
  });

  afterAll(async () => {
    await server.destroy();
    await pool.end();
  });

  it('allows connection with a valid session token', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });
    try {
      await waitFor(() => provider.synced, 5_000, 'provider to sync');
      expect(provider.isAuthenticated).toBe(true);
    } finally {
      provider.destroy();
    }
  });

  it('rejects API tokens on the public collaboration socket', async () => {
    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id);
    const tokenId = crypto.randomUUID();
    const token = `mdn_${tokenId.replaceAll('-', '')}_${'a'.repeat(43)}`;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await pool.query(
      `insert into api_tokens (id, user_id, name, token_hash, scopes)
       values ($1, $2, 'Agent test', $3, array['pages:read', 'pages:write'])`,
      [tokenId, user.id, tokenHash],
    );

    await expectAuthenticationFailure(port, token, page.id);
  });

  it('makes user metadata rooms read only to clients', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const connectionConfig = createConnectionConfig();
    await server.hocuspocus.hooks(
      'onAuthenticate',
      createAuthenticatePayload(server, {
        token: session.token,
        documentName: `page-meta:${user.id}`,
        connectionConfig,
      }),
    );
    expect(connectionConfig.readOnly).toBe(true);
  });

  it('closes connections that exceed the configured WebSocket payload limit', async () => {
    const limitedServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger: createMockLogger(),
      permissionRevalidationMs: 0,
      maxPayloadBytes: 1_024,
    });
    await limitedServer.listen();
    const port = (limitedServer as unknown as { address: { port: number } }).address.port;
    try {
      const closeCode = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(`ws://localhost:${port}`);
        const timeout = setTimeout(() => {
          socket.terminate();
          reject(new Error('Timed out waiting for oversized payload rejection'));
        }, 5_000);
        socket.on('open', () => socket.send(Buffer.alloc(1_025)));
        socket.on('close', (code) => {
          clearTimeout(timeout);
          resolve(code);
        });
        socket.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
      expect(closeCode).toBe(1009);
    } finally {
      await limitedServer.destroy();
    }
  });

  it('rejects empty, arbitrary, and nonexistent collaboration rooms', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    for (const documentName of ['', 'attacker-controlled-room', crypto.randomUUID()]) {
      await expect(
        server.hocuspocus.hooks(
          'onAuthenticate',
          createAuthenticatePayload(server, { documentName, token: session.token }),
        ),
      ).rejects.toThrow('Forbidden');
    }
  });

  it('rejects malformed anonymous identities before querying page access', async () => {
    const querySpy = vi.spyOn(pool, 'query');
    await expect(
      server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, {
          documentName: crypto.randomUUID(),
          token: 'anon:not-a-uuid\nforged-log-line',
        }),
      ),
    ).rejects.toThrow('Forbidden');
    expect(querySpy).not.toHaveBeenCalled();
  });

  it('rejects legacy anonymous identities with a share-token suffix before querying access', async () => {
    const querySpy = vi.spyOn(pool, 'query');
    await expect(
      server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, {
          documentName: crypto.randomUUID(),
          token: `anon:${crypto.randomUUID()}:${crypto.randomUUID()}`,
        }),
      ),
    ).rejects.toThrow('Forbidden');
    expect(querySpy).not.toHaveBeenCalled();
  });

  describe('authorization', () => {
    it('rejects awareness updates above the dedicated presence payload limit', async () => {
      const awarenessServer = createCollabServer({
        port: 0,
        internalSecret: 'test-collaboration-internal-secret',
        pool,
        logger: createMockLogger(),
        permissionRevalidationMs: 0,
        maxAwarenessPayloadBytes: 512,
      });
      await awarenessServer.listen();
      const awarenessPort = (awarenessServer as unknown as { address: { port: number } }).address
        .port;
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const session = await createTestSession(pool, owner.id);
      const document = new Y.Doc();
      const closed = vi.fn();
      const provider = new HocuspocusProvider({
        url: `ws://localhost:${awarenessPort}`,
        name: page.id,
        document,
        token: session.token,
        onClose: closed,
      });

      try {
        await waitFor(() => provider.synced, 5_000, 'limited-awareness provider to sync');
        const activeDocument = awarenessServer.hocuspocus.documents.get(page.id) as
          | Document
          | undefined;
        const connection = activeDocument?.getConnections()[0];
        if (!connection) throw new Error('Missing limited-awareness connection');
        const serverClose = vi.spyOn(connection, 'close');

        provider.configuration.websocketProvider.webSocket?.send(
          encodeAwarenessMessage(page.id, [
            {
              clientId: document.clientID,
              clock: 1,
              state: {
                user: {
                  name: 'Test User',
                  color: getStableColor(owner.id),
                  avatar: null,
                },
                padding: 'x'.repeat(2_048),
              },
            },
          ]),
        );

        await waitFor(
          () =>
            closed.mock.calls.length > 0 &&
            serverClose.mock.calls.some(
              (call) =>
                call[0]?.code === 4403 && call[0]?.reason === 'Awareness payload is too large',
            ),
          5_000,
          'oversized awareness sender to close',
        );
        expect(
          (
            activeDocument?.awareness.getStates().get(document.clientID) as
              | { padding?: string }
              | undefined
          )?.padding,
        ).toBeUndefined();
        serverClose.mockRestore();
      } finally {
        provider.destroy();
        await awarenessServer.destroy();
      }
    });

    it('rejects a raw client broadcast-stateless frame before any peer receives it', async () => {
      const owner = await createTestUser(pool);
      const attacker = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, attacker.id],
      );
      const ownerSession = await createTestSession(pool, owner.id);
      const attackerSession = await createTestSession(pool, attacker.id);
      const peerStateless = vi.fn();
      const attackerClosed = vi.fn();
      const ownerProvider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: new Y.Doc(),
        token: ownerSession.token,
        onStateless: peerStateless,
      });
      const attackerProvider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: new Y.Doc(),
        token: attackerSession.token,
        onClose: attackerClosed,
      });

      try {
        await waitFor(
          () => ownerProvider.synced && attackerProvider.synced,
          5_000,
          'stateless adversarial providers to sync',
        );
        peerStateless.mockClear();
        attackerProvider.configuration.websocketProvider.webSocket?.send(
          encodeProtocolMessage(
            page.id,
            6,
            JSON.stringify({
              type: 'permission_snapshot',
              permission: 'admin',
              accessRevision: '999999999999999999',
            }),
          ),
        );

        await waitFor(
          () => attackerClosed.mock.calls.length > 0,
          5_000,
          'forged stateless sender to close',
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        expect(peerStateless).not.toHaveBeenCalled();
      } finally {
        attackerProvider.destroy();
        ownerProvider.destroy();
      }
    });

    it('denies access to another users page on load', async () => {
      const intruder = await createTestUser(pool);
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const intruderSession = await createTestSession(pool, intruder.id);

      await expectAuthenticationFailure(port, intruderSession.token, page.id);
    });

    it('denies edits to another users page on store', async () => {
      const owner = await createTestUser(pool);
      const intruder = await createTestUser(pool);
      const ownerSession = await createTestSession(pool, owner.id);
      const intruderSession = await createTestSession(pool, intruder.id);
      const page = await createTestPage(pool, owner.id);
      const ownerDocument = new Y.Doc();
      const ownerProvider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: ownerDocument,
        token: ownerSession.token,
      });

      await waitFor(() => ownerProvider.synced, 5_000, 'owner provider to sync');
      ownerDocument.getText('content').insert(0, 'Owner content');
      ownerProvider.destroy();

      await expectAuthenticationFailure(port, intruderSession.token, page.id);
    });

    it('logs access denial when user does not own the page', async () => {
      const intruder = await createTestUser(pool);
      const intruderSession = await createTestSession(pool, intruder.id);
      const owner = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const payload = createAuthenticatePayload(server, {
        documentName: page.id,
        token: intruderSession.token,
      });

      await expect(server.hocuspocus.hooks('onAuthenticate', payload)).rejects.toThrow('Forbidden');
      expect(logger.debug).toHaveBeenCalledWith(
        `[auth] user=${intruder.id} denied access to page=${page.id} (invalid permission)`,
      );
    });
  });
});
