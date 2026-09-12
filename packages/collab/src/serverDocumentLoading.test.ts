import { HocuspocusProvider } from '@hocuspocus/provider';
import { Document, type onLoadDocumentPayload, type Server } from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createCollabServer } from './server';
import {
  createAccountHookContext,
  createConnectionConfig,
  createMockLogger,
  createUnverifiedAccountHookContext,
  waitFor,
} from './serverTestHarness';
import {
  createCorruptedYjsDoc,
  createTestPage,
  createTestSession,
  createTestUser,
  createTestYjsDoc,
  getTestPool,
} from './test-utils';

describe('collab server document loading', () => {
  const pool = getTestPool();
  const logger = createMockLogger();
  const ydocBytes = createTestYjsDoc('Hello from DB');
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

  it('creates a new document when the page has no stored ydoc', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const document = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document,
      token: session.token,
    });

    await waitFor(() => provider.synced, 5_000, 'provider to sync');
    expect(document.getText('content').toString()).toBe('');
    provider.destroy();
  });

  it('loads existing ydoc from the database', async () => {
    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id, 'Test Page', ydocBytes);
    const session = await createTestSession(pool, user.id);
    const document = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document,
      token: session.token,
    });

    await waitFor(() => provider.synced, 5_000, 'provider to sync');
    expect(document.getText('content').toString()).toBe('Hello from DB');
    provider.destroy();
  });

  it('rejects legacy editor updates after the Markdown cutover', async () => {
    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id, 'Canonical page', ydocBytes);
    const session = await createTestSession(pool, user.id);
    const legacyDocument = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    legacyDocument.getXmlFragment('prosemirror').push([paragraph]);
    paragraph.push([new Y.XmlText('Stale legacy edit')]);
    let closeReason = '';
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: legacyDocument,
      token: session.token,
      onClose: ({ event }) => {
        closeReason = event.reason;
      },
    });

    await waitFor(
      () => closeReason === 'Unsupported editor format',
      5_000,
      'legacy provider to be rejected',
    );
    provider.destroy();

    const result = await pool.query<{ ydoc: Buffer }>('select ydoc from pages where id = $1', [
      page.id,
    ]);
    const storedDocument = new Y.Doc();
    Y.applyUpdate(storedDocument, new Uint8Array(result.rows[0]?.ydoc ?? []));
    expect(storedDocument.getText('content').toString()).toBe('Hello from DB');
    expect(storedDocument.share.has('prosemirror')).toBe(false);
    storedDocument.destroy();
    legacyDocument.destroy();
  });

  it('preserves wiki-link target IDs during initial sync', async () => {
    const targetId = '44444444-4444-4444-4444-444444444444';
    const user = await createTestUser(pool);
    const sourceDocument = new Y.Doc();
    sourceDocument.getText('content').insert(0, `[[id:${targetId}]]`);
    const sourceState = Y.encodeStateAsUpdate(sourceDocument);
    const page = await createTestPage(pool, user.id, 'Source page', sourceState);
    const loadedDocument = new Document(page.id);

    await server.hocuspocus.hooks('onLoadDocument', {
      context: await createAccountHookContext(pool, user.id),
      document: loadedDocument,
      documentName: page.id,
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    });

    expect(loadedDocument.getText('content').toString()).toBe(`[[id:${targetId}]]`);
    expect(Buffer.from(Y.encodeStateAsUpdate(loadedDocument)).includes(Buffer.from(targetId))).toBe(
      true,
    );
    const stored = await pool.query<{ ydoc: Buffer }>('select ydoc from pages where id = $1', [
      page.id,
    ]);
    expect(stored.rows[0]?.ydoc.includes(Buffer.from(targetId))).toBe(true);
    sourceDocument.destroy();
  });

  it('serves the same content to two concurrent readers', async () => {
    const user = await createTestUser(pool);
    const page = await createTestPage(pool, user.id, 'Test Page', ydocBytes);
    const session = await createTestSession(pool, user.id);
    const firstDocument = new Y.Doc();
    const secondDocument = new Y.Doc();
    const firstProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: firstDocument,
      token: session.token,
    });
    const secondProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: secondDocument,
      token: session.token,
    });

    await waitFor(
      () => firstProvider.synced && secondProvider.synced,
      5_000,
      'both providers to sync',
    );
    expect(firstDocument.getText('content').toString()).toBe('Hello from DB');
    expect(secondDocument.getText('content').toString()).toBe('Hello from DB');
    firstProvider.destroy();
    secondProvider.destroy();
  });

  it('creates a new document when stored ydoc is an empty buffer', async () => {
    const user = await createTestUser(pool);
    const pageId = crypto.randomUUID();
    await pool.query(
      `insert into pages (id, parent_id, title, position, created_by, created_at, updated_at, ydoc)
       values ($1, null, 'Empty Buffer Page', '0', $2, now(), now(), $3)`,
      [pageId, user.id, Buffer.alloc(0)],
    );
    const payload: onLoadDocumentPayload = {
      context: await createAccountHookContext(pool, user.id),
      document: new Document(pageId),
      documentName: pageId,
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    };

    await expect(server.hocuspocus.hooks('onLoadDocument', payload)).resolves.toBeUndefined();
  });

  it('rejects when page does not exist in the database', async () => {
    const documentName = crypto.randomUUID();
    const payload: onLoadDocumentPayload = {
      context: createUnverifiedAccountHookContext(crypto.randomUUID()),
      document: new Document(documentName),
      documentName,
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    };

    await expect(server.hocuspocus.hooks('onLoadDocument', payload)).rejects.toThrow('Forbidden');
  });

  it('throws when stored ydoc contains corrupted binary data', async () => {
    const user = await createTestUser(pool);
    const pageId = crypto.randomUUID();
    await pool.query(
      `insert into pages (id, parent_id, title, position, created_by, created_at, updated_at, ydoc)
       values ($1, null, 'Corrupted Page', '0', $2, now(), now(), $3)`,
      [pageId, user.id, Buffer.from(createCorruptedYjsDoc())],
    );
    const payload: onLoadDocumentPayload = {
      context: await createAccountHookContext(pool, user.id),
      document: new Document(pageId),
      documentName: pageId,
      instance: server.hocuspocus,
      requestHeaders: new Headers(),
      requestParameters: new URLSearchParams(),
      socketId: crypto.randomUUID(),
      connectionConfig: createConnectionConfig(),
    };

    await expect(server.hocuspocus.hooks('onLoadDocument', payload)).rejects.toThrow();
  });
});
