import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  Document,
  type onChangePayload,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
  type Server,
} from '@hocuspocus/server';
import { MAX_PAGE_TITLE_LENGTH } from '@metakip/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { CollabSession } from './collabSession';
import { getSessionUser, waitForPermissionChecks } from './collabSession';
import { createCollabServer } from './server';
import {
  createAccountHookContext,
  createAnonymousHookContext,
  createConnectionConfig,
  createMockLogger as mockLogger,
  sleep,
  waitFor,
} from './serverTestHarness';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

describe('collab server document persistence', () => {
  const pool = getTestPool();
  const logger = mockLogger();
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger,
      debounceMs: 50,
      maxDebounceMs: 100,
      permissionRevalidationMs: 0,
    });
    await server.listen();
    port = (server as unknown as { address: { port: number } }).address.port;
  });
  afterAll(async () => {
    await server.destroy();
    await pool.end();
  });

  it('broadcasts a canonical title update without disconnecting collaborators', async () => {
    const owner = await createTestUser(pool);
    const session = await createTestSession(pool, owner.id);
    const page = await createTestPage(pool, owner.id);
    const document = new Y.Doc();
    const onDisconnect = vi.fn();
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document,
      token: session.token,
      onDisconnect,
    });

    try {
      await waitFor(() => provider.synced, 5_000, 'provider to sync');
      const titleText = document.getText('title');
      titleText.delete(0, titleText.length);
      titleText.insert(0, 'x'.repeat(MAX_PAGE_TITLE_LENGTH + 1));

      await waitFor(
        () => titleText.toString() === page.title,
        5_000,
        'canonical title compensation',
      );
      expect(onDisconnect).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`[title] rejected page=${page.id}`),
      );
    } finally {
      provider.destroy();
    }
  });

  it('restores and persists the canonical title after an oversized collaborative update', async () => {
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id);
    const document = new Document(page.id);
    const connection = { messageAddress: 'test', close: vi.fn(), send: vi.fn() };
    vi.spyOn(document, 'getConnections').mockReturnValue([connection] as unknown as ReturnType<
      Document['getConnections']
    >);
    server.hocuspocus.documents.set(page.id, document);
    const context = await createAccountHookContext(pool, owner.id);
    const loadPayload: onLoadDocumentPayload = {
      context,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    };
    const storePayload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: context,
      lastTransactionOrigin: null,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
    };

    try {
      await server.hocuspocus.hooks('onLoadDocument', loadPayload);
      const titleText = document.getText('title');
      titleText.delete(0, titleText.length);
      titleText.insert(0, 'x'.repeat(MAX_PAGE_TITLE_LENGTH + 1));
      await server.hocuspocus.hooks('onChange', {
        clientsCount: 1,
        context,
        document,
        documentName: page.id,
        instance: server.hocuspocus,
        requestHeaders: new Headers(),
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        transactionOrigin: null,
        update: Y.encodeStateAsUpdate(document),
      });

      await server.hocuspocus.hooks('onStoreDocument', storePayload);

      const after = await pool.query<{ title: string; ydoc: Buffer | null }>(
        'select title, ydoc from pages where id = $1',
        [page.id],
      );
      const persistedDocument = new Y.Doc();
      Y.applyUpdate(persistedDocument, new Uint8Array(after.rows[0]?.ydoc ?? []));
      expect(document.getText('title').toString()).toBe(page.title);
      expect(after.rows[0]?.title).toBe(page.title);
      expect(persistedDocument.getText('title').toString()).toBe(page.title);
      expect(connection.close).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`[title] rejected page=${page.id}`),
      );
    } finally {
      server.hocuspocus.documents.delete(page.id);
    }
  });

  it('counts astral Unicode titles by code point at the 250-character boundary', async () => {
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id);
    const document = new Document(page.id);
    const connection = { messageAddress: 'test', close: vi.fn(), send: vi.fn() };
    vi.spyOn(document, 'getConnections').mockReturnValue([connection] as unknown as ReturnType<
      Document['getConnections']
    >);
    server.hocuspocus.documents.set(page.id, document);
    const context = await createAccountHookContext(pool, owner.id);
    const payloadBase = {
      clientsCount: 1,
      context,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
    };
    const storePayloadBase = {
      clientsCount: payloadBase.clientsCount,
      lastContext: payloadBase.context,
      lastTransactionOrigin: null,
      document: payloadBase.document,
      documentName: payloadBase.documentName,
      instance: payloadBase.instance,
    };

    try {
      await server.hocuspocus.hooks('onLoadDocument', {
        ...payloadBase,
        connectionConfig: createConnectionConfig(),
      });
      const titleText = document.getText('title');
      const acceptedTitle = '😀'.repeat(MAX_PAGE_TITLE_LENGTH);
      titleText.delete(0, titleText.length);
      titleText.insert(0, acceptedTitle);
      await server.hocuspocus.hooks('onChange', {
        ...payloadBase,
        transactionOrigin: connection,
        update: Y.encodeStateAsUpdate(document),
      });
      await server.hocuspocus.hooks('onStoreDocument', storePayloadBase);
      expect(document.getText('title').toString()).toBe(acceptedTitle);
      const accepted = await pool.query<{ title: string }>(
        'select title from pages where id = $1',
        [page.id],
      );
      expect(accepted.rows[0]?.title).toBe(acceptedTitle);

      titleText.delete(0, titleText.length);
      titleText.insert(0, `${acceptedTitle}😀`);
      await server.hocuspocus.hooks('onChange', {
        ...payloadBase,
        transactionOrigin: connection,
        update: Y.encodeStateAsUpdate(document),
      });
      await server.hocuspocus.hooks('onStoreDocument', storePayloadBase);
      expect(document.getText('title').toString()).toBe(acceptedTitle);
      const rejected = await pool.query<{ title: string }>(
        'select title from pages where id = $1',
        [page.id],
      );
      expect(rejected.rows[0]?.title).toBe(acceptedTitle);
      expect(connection.close).not.toHaveBeenCalled();
    } finally {
      server.hocuspocus.documents.delete(page.id);
    }
  });

  it('fails closed when persistence permission verification is unavailable', async () => {
    const verificationLogger = mockLogger();
    const verificationPool = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        if (text.includes('get_effective_page_permission')) {
          throw new Error('permission database unavailable');
        }
        return pool.query(text, values);
      }),
    } as unknown as typeof pool;
    const verificationServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool: verificationPool,
      logger: verificationLogger,
      permissionRevalidationMs: 0,
    });
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id);
    const document = new Document(page.id);
    document.getText('content').insert(0, 'Unverified edit');
    const connection = { messageAddress: 'test', send: vi.fn(), close: vi.fn() };
    vi.spyOn(document, 'getConnections').mockReturnValue([connection] as unknown as ReturnType<
      Document['getConnections']
    >);
    verificationServer.hocuspocus.documents.set(page.id, document);
    const before = await pool.query<{ ydoc: Buffer | null }>(
      'select ydoc from pages where id = $1',
      [page.id],
    );
    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, owner.id),
      lastTransactionOrigin: null,
      document,
      documentName: page.id,
      instance: verificationServer.hocuspocus,
    };
    await verificationServer.hocuspocus.hooks('onChange', {
      clientsCount: 1,
      context: payload.lastContext,
      document,
      documentName: page.id,
      instance: verificationServer.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      transactionOrigin: null,
      update: Y.encodeStateAsUpdate(document),
    });

    try {
      await verificationServer.hocuspocus.hooks('onStoreDocument', payload);
      expect(connection.close).toHaveBeenCalledWith({
        code: 4500,
        reason: 'Permission verification failed',
      });
      const after = await pool.query<{ ydoc: Buffer | null }>(
        'select ydoc from pages where id = $1',
        [page.id],
      );
      expect(after.rows[0]?.ydoc).toEqual(before.rows[0]?.ydoc);
      expect(verificationLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('permission verification failed'),
      );
    } finally {
      verificationServer.hocuspocus.documents.delete(page.id);
      await verificationServer.destroy();
    }
  });

  it('rethrows unexpected persistence verification errors after failing closed', async () => {
    const unexpectedLogger = mockLogger();
    const unexpectedServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger: unexpectedLogger,
      permissionRevalidationMs: 0,
    });
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id);
    const unexpectedError = new Error('forced connection update failure');
    const activeDocument = {
      getConnections: () => {
        throw unexpectedError;
      },
    } as unknown as Document;
    unexpectedServer.hocuspocus.documents.set(page.id, activeDocument);
    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, owner.id),
      lastTransactionOrigin: null,
      document: new Document(page.id),
      documentName: page.id,
      instance: unexpectedServer.hocuspocus,
    };

    try {
      await expect(unexpectedServer.hocuspocus.hooks('onStoreDocument', payload)).rejects.toThrow(
        'forced connection update failure',
      );
      expect(unexpectedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('unexpected permission revalidation failure'),
      );
    } finally {
      unexpectedServer.hocuspocus.documents.delete(page.id);
      await unexpectedServer.destroy();
    }
  });

  it('rethrows and logs when persistence update fails', async () => {
    const failingLogger = mockLogger();
    const mockClient = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        if (
          text.startsWith('update pages set ydoc') ||
          text.startsWith('update "pages" set "ydoc"')
        ) {
          throw new Error('forced db failure');
        }
        return pool.query(text, values);
      }),
      release: vi.fn(),
    };
    const failingPool = {
      connect: vi.fn(async () => mockClient),
      query: vi.fn(async (text: string, values?: unknown[]) => {
        return pool.query(text, values);
      }),
    } as unknown as typeof pool;
    const failingServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool: failingPool,
      logger: failingLogger,
      debounceMs: 50,
      maxDebounceMs: 100,
      permissionRevalidationMs: 0,
    });

    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id);
    const documentName = page.id;
    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, user.id, 'edit'),
      lastTransactionOrigin: null,
      document: new Document(documentName),
      documentName,
      instance: failingServer.hocuspocus,
    };

    await expect(failingServer.hocuspocus.hooks('onStoreDocument', payload)).rejects.toThrow(
      'forced db failure',
    );
    expect(failingLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(`[persist] failed to save "${documentName}"`),
    );
  });

  it('rechecks writer access under the workspace lock before persistence', async () => {
    const owner = await createTestUser(pool);
    const editor = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id);
    await pool.query(
      `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'edit')`,
      [page.id, owner.id, editor.id],
    );

    let resolveLockAttempt: (() => void) | undefined;
    const lockAttempted = new Promise<void>((resolve) => {
      resolveLockAttempt = resolve;
    });
    const persistencePool = {
      query: (text: string, values?: unknown[]) => pool.query(text, values),
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (text: string, values?: unknown[]) => {
            if (text.includes('pg_advisory_xact_lock')) resolveLockAttempt?.();
            return client.query(text, values);
          },
          release: () => client.release(),
        };
      },
    } as unknown as typeof pool;
    const lockedServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool: persistencePool,
      logger: mockLogger(),
      permissionRevalidationMs: 0,
    });
    const permissionMutation = await pool.connect();
    let mutationOpen = true;
    await permissionMutation.query('BEGIN');
    await permissionMutation.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `workspace-access:${owner.id}`,
    ]);

    const document = new Document(page.id);
    document.getText('content').insert(0, 'Stale editor update');
    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, editor.id, 'edit'),
      lastTransactionOrigin: null,
      document,
      documentName: page.id,
      instance: lockedServer.hocuspocus,
    };

    try {
      const storePromise = lockedServer.hocuspocus.hooks('onStoreDocument', payload);
      await lockAttempted;
      await permissionMutation.query(
        `DELETE FROM shares
           WHERE entity_type = 'page' AND entity_id = $1 AND recipient_user_id = $2`,
        [page.id, editor.id],
      );
      await permissionMutation.query('COMMIT');
      mutationOpen = false;
      await storePromise;

      const stored = await pool.query<{ ydoc: Buffer | null }>(
        'SELECT ydoc FROM pages WHERE id = $1',
        [page.id],
      );
      expect(stored.rows[0]?.ydoc).toBeNull();
    } finally {
      if (mutationOpen) await permissionMutation.query('ROLLBACK');
      permissionMutation.release();
      await lockedServer.destroy();
    }
  });

  it('does not persist anonymous edits after public access is revoked', async () => {
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id);
    const anonymousId = crypto.randomUUID();
    await pool.query("update pages set public_permission = 'edit' where id = $1", [page.id]);

    const document = new Document(page.id);
    document.getText('content').insert(0, 'Revoked anonymous edit');
    const connection = {
      context: createAnonymousHookContext(anonymousId, 'edit'),
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const activeDocument = {
      getConnections: () => [connection],
    } as unknown as Document;
    server.hocuspocus.documents.set(page.id, activeDocument);
    await pool.query('update pages set public_permission = null where id = $1', [page.id]);

    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: createAnonymousHookContext(anonymousId, 'edit'),
      lastTransactionOrigin: null,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
    };

    try {
      await server.hocuspocus.hooks('onStoreDocument', payload);
    } finally {
      server.hocuspocus.documents.delete(page.id);
    }

    const stored = await pool.query<{ ydoc: Buffer | null }>(
      'SELECT ydoc FROM pages WHERE id = $1',
      [page.id],
    );
    expect(stored.rows[0]?.ydoc).toBeNull();
    expect(connection.close).toHaveBeenCalledWith({ code: 4401, reason: 'Access revoked' });
  });

  it('rejects a debounced document containing an update from a revoked writer', async () => {
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id);
    const anonymousId = crypto.randomUUID();
    await pool.query("update pages set public_permission = 'edit' where id = $1", [page.id]);
    const document = new Document(page.id);
    document.getText('content').insert(0, 'mixed update');
    const changeBase = {
      clientsCount: 2,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      transactionOrigin: null,
      update: new Uint8Array([1]),
    } satisfies Omit<onChangePayload, 'context'>;

    await server.hocuspocus.hooks('onChange', {
      ...changeBase,
      context: createAnonymousHookContext(anonymousId, 'edit'),
    });
    await server.hocuspocus.hooks('onChange', {
      ...changeBase,
      context: await createAccountHookContext(pool, owner.id, 'edit'),
    });
    const anonymousConnection = {
      context: createAnonymousHookContext(anonymousId, 'edit'),
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const ownerConnection = {
      context: await createAccountHookContext(pool, owner.id, 'edit'),
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const activeDocument = {
      getConnections: () => [anonymousConnection, ownerConnection],
    } as unknown as Document;
    server.hocuspocus.documents.set(page.id, activeDocument);
    await pool.query('update pages set public_permission = null where id = $1', [page.id]);

    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, owner.id, 'edit'),
      lastTransactionOrigin: null,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
    };
    try {
      await server.hocuspocus.hooks('onStoreDocument', payload);
    } finally {
      server.hocuspocus.documents.delete(page.id);
    }

    const stored = await pool.query<{ ydoc: Buffer | null }>(
      'SELECT ydoc FROM pages WHERE id = $1',
      [page.id],
    );
    expect(stored.rows[0]?.ydoc).toBeNull();
    expect(anonymousConnection.sendStateless).toHaveBeenCalledWith(
      expect.stringContaining('"action":"revoke"'),
    );
    expect(ownerConnection.sendStateless).not.toHaveBeenCalled();
    expect(ownerConnection.close).toHaveBeenCalledWith({
      code: 4500,
      reason: 'Document reload required',
    });
  });

  it('persists content edits to the database', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: doc,
      token: session.token,
    });

    await waitFor(() => provider.synced, 5_000, 'provider to sync');

    doc.getText('content').insert(0, 'Persisted content');

    await waitFor(
      async () => {
        const res = await pool.query('SELECT ydoc FROM pages WHERE id = $1', [page.id]);
        return res.rows[0]?.ydoc !== null;
      },
      5_000,
      'content to persist',
    );

    const result = await pool.query('SELECT ydoc FROM pages WHERE id = $1', [page.id]);

    const loadedDoc = new Y.Doc();
    Y.applyUpdate(loadedDoc, new Uint8Array(result.rows[0].ydoc as Buffer));
    expect(loadedDoc.getText('content').toString()).toBe('Persisted content');

    provider.destroy();
  });

  it('loads previously persisted content on reconnection', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    const doc1 = new Y.Doc();
    const provider1 = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: doc1,
      token: session.token,
    });

    await waitFor(() => provider1.synced, 5_000, 'provider1 to sync');
    doc1.getText('content').insert(0, 'Round trip content');

    await waitFor(
      async () => {
        const res = await pool.query('SELECT ydoc FROM pages WHERE id = $1', [page.id]);
        return res.rows[0]?.ydoc !== null;
      },
      5_000,
      'content to persist',
    );

    provider1.destroy();

    const doc2 = new Y.Doc();
    const provider2 = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: doc2,
      token: session.token,
    });

    await waitFor(() => provider2.synced, 5_000, 'provider2 to sync');
    expect(doc2.getText('content').toString()).toBe('Round trip content');

    provider2.destroy();
    await waitFor(
      () => !server.hocuspocus.documents.has(page.id),
      5_000,
      'reconnected provider document to unload',
    );
  });

  it('coalesces rapid edits into fewer persistence calls via debounce', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);

    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: doc,
      token: session.token,
    });

    await waitFor(() => provider.synced, 5_000, 'provider to sync');
    const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
    const serverConnection = activeDocument?.getConnections().find((connection) => {
      const connectionContext = connection.context as CollabSession | undefined;
      return connectionContext?.principal && getSessionUser(connectionContext).id === user.id;
    });
    if (!serverConnection) throw new Error('Missing server-side coalescing connection');
    await waitForPermissionChecks(serverConnection.context as CollabSession);

    // Spy on pool.connect calls — each persistDocument call acquires a client,
    // so connect call count after the initial sync fence reflects persistence
    // and per-update authorization work from the edits below.
    const connectSpy = vi.spyOn(pool, 'connect');
    await sleep(500);
    connectSpy.mockClear();

    const text = doc.getText('content');
    text.insert(0, 'Edit 1');
    await sleep(10);
    text.insert(6, ' Edit 2');
    await sleep(10);
    text.insert(13, ' Edit 3');
    await sleep(10);
    text.insert(20, ' Edit 4');
    await sleep(10);
    text.insert(27, ' Edit 5');

    await sleep(200);

    // 5 edits within debounce window should produce far fewer connects than edits.
    // Each debounced onStoreDocument also verifies access before persisting.
    // Metadata fan-out is skipped here because no user meta room is active.
    expect(connectSpy.mock.calls.length).toBeGreaterThan(0);
    expect(connectSpy.mock.calls.length).toBeLessThanOrEqual(6);

    // Final content in DB should reflect all edits
    const result = await pool.query('SELECT ydoc FROM pages WHERE id = $1', [page.id]);
    const loadedDoc = new Y.Doc();
    Y.applyUpdate(loadedDoc, new Uint8Array(result.rows[0].ydoc as Buffer));
    const finalContent = loadedDoc.getText('content').toString();
    expect(finalContent).toContain('Edit 5');

    connectSpy.mockRestore();
    provider.destroy();
  });

  it('does not overwrite a newer database Yjs snapshot under the persistence lock', async () => {
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id, 'Merge page');
    const document = new Document(page.id);
    const context = await createAccountHookContext(pool, owner.id);
    await server.hocuspocus.hooks('onLoadDocument', {
      context,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    });
    document.getText('local').insert(0, 'local state');
    await server.hocuspocus.hooks('onChange', {
      clientsCount: 1,
      context,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      transactionOrigin: null,
      update: Y.encodeStateAsUpdate(document),
    });
    const newerDatabaseDocument = new Y.Doc();
    newerDatabaseDocument.getText('remote').insert(0, 'newer database state');
    await pool.query('update pages set ydoc = $1 where id = $2', [
      Y.encodeStateAsUpdate(newerDatabaseDocument),
      page.id,
    ]);

    await server.hocuspocus.hooks('onStoreDocument', {
      clientsCount: 1,
      lastContext: context,
      lastTransactionOrigin: null,
      document,
      documentName: page.id,
      instance: server.hocuspocus,
    });

    const stored = await pool.query<{ ydoc: Buffer }>('select ydoc from pages where id = $1', [
      page.id,
    ]);
    const storedDocument = new Y.Doc();
    Y.applyUpdate(storedDocument, new Uint8Array(stored.rows[0]?.ydoc ?? []));
    expect(storedDocument.getText('local').toString()).toBe('');
    expect(storedDocument.getText('remote').toString()).toBe('newer database state');
  });

  it('rejects persistence when user context is missing', async () => {
    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: {},
      lastTransactionOrigin: null,
      document: new Document(crypto.randomUUID()),
      documentName: crypto.randomUUID(),
      instance: server.hocuspocus,
    };

    await expect(server.hocuspocus.hooks('onStoreDocument', payload)).rejects.toThrow(
      'Unauthorized',
    );
  });

  it('does not persist an oversized document', async () => {
    const sizeLogger = mockLogger();
    const sizeLimitedServer = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger: sizeLogger,
      permissionRevalidationMs: 0,
      maxDocumentBytes: 256,
    });
    const owner = await createTestUser(pool);
    const page = await createTestPage(pool, owner.id);
    const before = await pool.query<{ ydoc: Buffer | null }>(
      'select ydoc from pages where id = $1',
      [page.id],
    );
    const document = new Document(page.id);
    document.getText('content').insert(0, 'x'.repeat(2_048));
    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, owner.id),
      lastTransactionOrigin: null,
      document,
      documentName: page.id,
      instance: sizeLimitedServer.hocuspocus,
    };

    try {
      await sizeLimitedServer.hocuspocus.hooks('onStoreDocument', payload);
      const after = await pool.query<{ ydoc: Buffer | null }>(
        'select ydoc from pages where id = $1',
        [page.id],
      );
      expect(after.rows[0]?.ydoc).toEqual(before.rows[0]?.ydoc);
      expect(sizeLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`[size] blocked page=${page.id}`),
      );
    } finally {
      await sizeLimitedServer.destroy();
    }
  });
});
