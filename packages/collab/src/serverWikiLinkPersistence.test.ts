import { HocuspocusProvider } from '@hocuspocus/provider';
import { Document, type onStoreDocumentPayload, type Server } from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  broadcastWikiLinkPresentationInvalidation,
  createCollabServer,
  publishPageDeletion,
  publishPageRename,
} from './server';
import {
  appendWikiLink,
  createAccountHookContext,
  createAnonymousHookContext,
  createMockLogger as mockLogger,
  waitFor,
} from './serverTestHarness';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

describe('collab server wiki-link persistence', () => {
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

  it('does not index a wiki-link targetId from another workspace', async () => {
    const sourceOwner = await createTestUser(pool);
    const otherOwner = await createTestUser(pool);
    const source = await createTestPage(pool, sourceOwner.id, 'Source');
    const externalTarget = await createTestPage(pool, otherOwner.id, 'External Target');
    const document = new Document(source.id);
    appendWikiLink(document, {
      path: 'missing-in-source-workspace',
      label: 'External Target',
      targetId: externalTarget.id,
    });

    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, sourceOwner.id),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    };

    await server.hocuspocus.hooks('onStoreDocument', payload);

    const result = await pool.query<{ target_id: string | null }>(
      `SELECT target_id FROM connections
         WHERE source_id = $1 AND target_slug = $2`,
      [source.id, `id:${externalTarget.id}`],
    );
    expect(result.rows[0]?.target_id).toBeNull();
  });

  it('does not restore a stale cross-workspace target in the derived index', async () => {
    const sourceOwner = await createTestUser(pool);
    const otherOwner = await createTestUser(pool);
    const source = await createTestPage(pool, sourceOwner.id, 'Source');
    const externalTarget = await createTestPage(pool, otherOwner.id, 'External Target');
    await pool.query(
      `INSERT INTO connections (
           source_type, source_id, target_type, target_id, target_slug,
           target_label, connection_type, link_text, occurrence_count, updated_at
         ) VALUES ('page', $1, 'page', $2, 'renamed-target',
                   'External Target', 'wikilink', 'External Target', 1, NOW())`,
      [source.id, externalTarget.id],
    );

    const document = new Document(source.id);
    appendWikiLink(document, { path: 'renamed-target', label: 'External Target' });
    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, sourceOwner.id),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    };

    await server.hocuspocus.hooks('onStoreDocument', payload);

    const result = await pool.query<{ target_id: string | null }>(
      `SELECT target_id FROM connections
         WHERE source_id = $1 AND target_slug = 'renamed-target'`,
      [source.id],
    );
    expect(result.rows[0]?.target_id).toBeNull();
  });

  it('retains a same-workspace targetId in the derived connection index', async () => {
    const owner = await createTestUser(pool);
    const editor = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Shared Source');
    const hiddenTarget = await createTestPage(pool, owner.id, 'Hidden Canonical Title');
    await pool.query(
      `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('page', $1, $2, $3, 'edit')`,
      [source.id, owner.id, editor.id],
    );

    const document = new Document(source.id);
    appendWikiLink(document, {
      path: 'authored-unresolved-path',
      label: 'Authored Alias',
      targetId: hiddenTarget.id,
    });
    await server.hocuspocus.hooks('onStoreDocument', {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, editor.id, 'edit'),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    });

    const result = await pool.query<{
      target_id: string | null;
      target_label: string;
      link_text: string | null;
    }>(
      `select target_id, target_label, link_text
         from connections
         where source_id = $1 and target_slug = $2`,
      [source.id, `id:${hiddenTarget.id}`],
    );
    expect(result.rows[0]).toEqual({
      target_id: hiddenTarget.id,
      target_label: 'Hidden Canonical Title',
      link_text: 'Authored Alias',
    });
  });

  it('does not resolve a same-workspace hidden title for a page editor', async () => {
    const owner = await createTestUser(pool);
    const editor = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Shared Source');
    await createTestPage(pool, owner.id, 'Hidden Slug Target');
    await pool.query(
      `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('page', $1, $2, $3, 'edit')`,
      [source.id, owner.id, editor.id],
    );

    const document = new Document(source.id);
    appendWikiLink(document, { path: 'hidden slug target', label: 'Authored Alias' });
    await server.hocuspocus.hooks('onStoreDocument', {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, editor.id, 'edit'),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    });

    const result = await pool.query<{
      target_id: string | null;
      target_label: string;
      link_text: string | null;
    }>(
      `select target_id, target_label, link_text
         from connections
         where source_id = $1 and target_slug = 'hidden slug target'`,
      [source.id],
    );
    expect(result.rows[0]).toEqual({
      target_id: null,
      target_label: 'hidden slug target',
      link_text: 'Authored Alias',
    });
  });

  it('uses the intersection of every writer in a debounced document batch', async () => {
    const owner = await createTestUser(pool);
    const editor = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Shared Source');
    await createTestPage(pool, owner.id, 'Owner Only Target');
    await pool.query(
      `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('page', $1, $2, $3, 'edit')`,
      [source.id, owner.id, editor.id],
    );

    const document = new Document(source.id);
    appendWikiLink(document, {
      path: 'owner-only-target',
      label: 'Authored Alias',
    });
    const ownerContext = await createAccountHookContext(pool, owner.id, 'edit');
    const editorContext = await createAccountHookContext(pool, editor.id, 'edit');
    server.hocuspocus.documents.set(source.id, document);
    try {
      for (const [context, update] of [
        [ownerContext, new Uint8Array([1])],
        [editorContext, new Uint8Array([2])],
      ] as const) {
        await server.hocuspocus.hooks('onChange', {
          clientsCount: 2,
          context,
          document,
          documentName: source.id,
          instance: server.hocuspocus,
          requestHeaders: new Headers(),
          requestParameters: new URLSearchParams(),
          socketId: crypto.randomUUID(),
          transactionOrigin: null,
          update,
        });
      }

      await server.hocuspocus.hooks('onStoreDocument', {
        clientsCount: 2,
        lastContext: ownerContext,
        lastTransactionOrigin: null,
        document,
        documentName: source.id,
        instance: server.hocuspocus,
      });
    } finally {
      server.hocuspocus.documents.delete(source.id);
    }

    const result = await pool.query<{ target_id: string | null; target_label: string }>(
      `select target_id, target_label from connections
         where source_id = $1 and target_slug = 'owner-only-target'`,
      [source.id],
    );
    expect(result.rows[0]).toEqual({
      target_id: null,
      target_label: 'owner-only-target',
    });
  });

  it('intersects authenticated and anonymous writers in one debounced batch', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Public Editable Source');
    await createTestPage(pool, owner.id, 'Account Only Target');
    await pool.query("update pages set public_permission = 'edit' where id = $1", [source.id]);

    const document = new Document(source.id);
    appendWikiLink(document, {
      path: 'account-only-target',
      label: 'Authored Alias',
    });
    const ownerContext = await createAccountHookContext(pool, owner.id, 'edit');
    const anonymousContext = createAnonymousHookContext(crypto.randomUUID(), 'edit');
    server.hocuspocus.documents.set(source.id, document);
    try {
      for (const [context, update] of [
        [ownerContext, new Uint8Array([1])],
        [anonymousContext, new Uint8Array([2])],
      ] as const) {
        await server.hocuspocus.hooks('onChange', {
          clientsCount: 2,
          context,
          document,
          documentName: source.id,
          instance: server.hocuspocus,
          requestHeaders: new Headers(),
          requestParameters: new URLSearchParams(),
          socketId: crypto.randomUUID(),
          transactionOrigin: null,
          update,
        });
      }
      await server.hocuspocus.hooks('onStoreDocument', {
        clientsCount: 2,
        lastContext: ownerContext,
        lastTransactionOrigin: null,
        document,
        documentName: source.id,
        instance: server.hocuspocus,
      });
    } finally {
      server.hocuspocus.documents.delete(source.id);
    }

    const result = await pool.query<{ target_id: string | null; target_label: string }>(
      `select target_id, target_label from connections
         where source_id = $1 and target_slug = 'account-only-target'`,
      [source.id],
    );
    expect(result.rows[0]).toEqual({
      target_id: null,
      target_label: 'account-only-target',
    });
  });

  it('does not resolve a private target for an anonymous public editor', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Public Editable Source');
    await createTestPage(pool, owner.id, 'Private Target');
    await pool.query("update pages set public_permission = 'edit' where id = $1", [source.id]);

    const document = new Document(source.id);
    appendWikiLink(document, {
      path: 'private-target',
      label: 'Authored Alias',
    });
    await server.hocuspocus.hooks('onStoreDocument', {
      clientsCount: 1,
      lastContext: createAnonymousHookContext(crypto.randomUUID(), 'edit'),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    });

    const result = await pool.query<{ target_id: string | null; target_label: string }>(
      `select target_id, target_label from connections
         where source_id = $1 and target_slug = 'private-target'`,
      [source.id],
    );
    expect(result.rows[0]).toEqual({ target_id: null, target_label: 'private-target' });
  });

  it('does not use folder paths to expose structure to an anonymous editor', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Public Editable Source');
    const target = await createTestPage(pool, owner.id, 'Public Target');
    const folderId = crypto.randomUUID();
    await pool.query(
      `insert into folders (
           id, name, position, created_by, public_permission, created_at, updated_at
         ) values ($1, 'Internal Structure', '0', $2, 'view', now(), now())`,
      [folderId, owner.id],
    );
    await pool.query('update pages set parent_id = $1 where id = $2', [folderId, target.id]);
    await pool.query("update pages set public_permission = 'edit' where id = $1", [source.id]);

    const document = new Document(source.id);
    appendWikiLink(document, {
      path: 'Internal Structure/Public Target',
      label: 'Authored path',
    });
    await server.hocuspocus.hooks('onStoreDocument', {
      clientsCount: 1,
      lastContext: createAnonymousHookContext(crypto.randomUUID(), 'edit'),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    });

    const result = await pool.query<{ target_id: string | null }>(
      `select target_id from connections
         where source_id = $1 and target_slug = 'internal structure/public target'`,
      [source.id],
    );
    expect(result.rows[0]?.target_id).toBeNull();
  });

  it('resolves a target that the page editor can enumerate', async () => {
    const owner = await createTestUser(pool);
    const editor = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Shared Source');
    const target = await createTestPage(pool, owner.id, 'Visible Target');
    await pool.query(
      `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values
           ('page', $1, $2, $3, 'edit'),
           ('page', $4, $2, $3, 'view')`,
      [source.id, owner.id, editor.id, target.id],
    );

    const document = new Document(source.id);
    appendWikiLink(document, { path: '/Visible Target.md#Section', label: 'Authored Alias' });
    await server.hocuspocus.hooks('onStoreDocument', {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, editor.id, 'edit'),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    });

    const result = await pool.query<{ target_id: string | null; target_label: string }>(
      `select target_id, target_label
         from connections
         where source_id = $1 and target_slug = 'visible target'`,
      [source.id],
    );
    expect(result.rows[0]).toEqual({ target_id: target.id, target_label: 'Visible Target' });
  });

  it('resolves explicit paths only through folder ancestry the editor can enumerate', async () => {
    const owner = await createTestUser(pool);
    const editor = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Shared Source');
    const target = await createTestPage(pool, owner.id, 'Path Target');
    const privateFolderId = crypto.randomUUID();
    await pool.query(
      `insert into folders (id, name, position, created_by, created_at, updated_at)
         values ($1, 'Private Folder', '0', $2, now(), now())`,
      [privateFolderId, owner.id],
    );
    await pool.query('update pages set parent_id = $1 where id = $2', [privateFolderId, target.id]);
    await pool.query(
      `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values
           ('page', $1, $2, $3, 'edit'),
           ('page', $4, $2, $3, 'view')`,
      [source.id, owner.id, editor.id, target.id],
    );

    const document = new Document(source.id);
    appendWikiLink(document, {
      path: 'private folder/path target',
      label: 'Authored Alias',
    });
    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, editor.id, 'edit'),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    };
    await server.hocuspocus.hooks('onStoreDocument', payload);

    const hiddenResult = await pool.query<{ target_id: string | null }>(
      `select target_id from connections
         where source_id = $1 and target_slug = 'private folder/path target'`,
      [source.id],
    );
    expect(hiddenResult.rows[0]?.target_id).toBeNull();

    await pool.query(
      `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('folder', $1, $2, $3, 'view')`,
      [privateFolderId, owner.id, editor.id],
    );
    await server.hocuspocus.hooks('onStoreDocument', payload);

    const visibleResult = await pool.query<{ target_id: string | null; target_label: string }>(
      `select target_id, target_label from connections
         where source_id = $1 and target_slug = 'private folder/path target'`,
      [source.id],
    );
    expect(visibleResult.rows[0]).toEqual({
      target_id: target.id,
      target_label: 'Path Target',
    });
  });

  it('uses the shared normalizer for explicit paths with a one-character folder', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Source');
    const target = await createTestPage(pool, owner.id, 'Path Target');
    const folderId = crypto.randomUUID();
    await pool.query(
      `insert into folders (id, name, position, created_by, created_at, updated_at)
         values ($1, 'X', '0', $2, now(), now())`,
      [folderId, owner.id],
    );
    await pool.query('update pages set parent_id = $1 where id = $2', [folderId, target.id]);

    const document = new Document(source.id);
    appendWikiLink(document, {
      path: '/X/Path Target.md#Details',
      label: 'Path target details',
    });
    await server.hocuspocus.hooks('onStoreDocument', {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, owner.id),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    });

    const result = await pool.query<{ target_id: string | null; target_label: string }>(
      `select target_id, target_label from connections
         where source_id = $1 and target_slug = 'x/path target'`,
      [source.id],
    );
    expect(result.rows[0]).toEqual({ target_id: target.id, target_label: 'Path Target' });
  });

  it('retains a valid wiki-link targetId from the source workspace', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Source');
    const target = await createTestPage(pool, owner.id, 'Roadmap');
    const document = new Document(source.id);
    appendWikiLink(document, { path: 'roadmap', label: 'Roadmap', targetId: target.id });

    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, owner.id),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    };

    await server.hocuspocus.hooks('onStoreDocument', payload);

    const result = await pool.query<{ target_id: string | null }>(
      `SELECT target_id FROM connections
         WHERE source_id = $1 AND target_slug = $2`,
      [source.id, `id:${target.id}`],
    );
    expect(result.rows[0]?.target_id).toBe(target.id);
  });

  it('keeps a trusted duplicate-title target after that target is renamed', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Source');
    await createTestPage(pool, owner.id, 'Duplicate title');
    const selected = await createTestPage(pool, owner.id, 'Duplicate title');
    await pool.query(
      `insert into connections (
           source_type, source_id, target_type, target_id, target_slug,
           target_label, connection_type, link_text
         ) values ('page', $1, 'page', $2, 'duplicate title',
                   'Duplicate title', 'wikilink', 'Duplicate title')`,
      [source.id, selected.id],
    );
    await pool.query('update pages set title = $1 where id = $2', ['Renamed target', selected.id]);

    const document = new Document(source.id);
    appendWikiLink(document, { path: 'Duplicate title', label: 'Duplicate title' });
    await server.hocuspocus.hooks('onStoreDocument', {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, owner.id),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    });

    const result = await pool.query<{ target_id: string | null; target_label: string }>(
      `select target_id, target_label from connections
         where source_id = $1 and target_slug = 'duplicate title'`,
      [source.id],
    );
    expect(result.rows[0]).toEqual({ target_id: selected.id, target_label: 'Renamed target' });
  });

  it('notifies target viewers when a backlink is added and removed', async () => {
    const owner = await createTestUser(pool);
    const targetViewer = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Private source');
    const target = await createTestPage(pool, owner.id, 'Visible target');
    await pool.query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
      [target.id, owner.id, targetViewer.id],
    );
    const ownerMeta = new Document(`page-meta:${owner.id}`);
    const viewerMeta = new Document(`page-meta:${targetViewer.id}`);
    server.hocuspocus.documents.set(`page-meta:${owner.id}`, ownerMeta);
    server.hocuspocus.documents.set(`page-meta:${targetViewer.id}`, viewerMeta);

    const document = new Document(source.id);
    appendWikiLink(document, { path: 'visible target', label: 'Visible target' });
    const payload: onStoreDocumentPayload = {
      clientsCount: 1,
      lastContext: await createAccountHookContext(pool, owner.id),
      lastTransactionOrigin: null,
      document,
      documentName: source.id,
      instance: server.hocuspocus,
    };

    try {
      await server.hocuspocus.hooks('onStoreDocument', payload);
      expect(ownerMeta.getMap('backlinksVersion').get(target.id)).toEqual(expect.any(Number));
      expect(viewerMeta.getMap('backlinksVersion').get(target.id)).toEqual(expect.any(Number));
      expect(viewerMeta.getMap('backlinksVersion').has(source.id)).toBe(false);
      const addedVersion = viewerMeta.getMap<number>('backlinksVersion').get(target.id);
      if (addedVersion === undefined) throw new Error('Missing added backlink version');

      const content = document.getText('content');
      content.delete(0, content.length);
      await server.hocuspocus.hooks('onStoreDocument', payload);

      expect(ownerMeta.getMap('backlinksVersion').get(target.id)).toEqual(expect.any(Number));
      expect(viewerMeta.getMap<number>('backlinksVersion').get(target.id)).toBeGreaterThan(
        addedVersion,
      );
      expect(viewerMeta.getMap('backlinksVersion').has(source.id)).toBe(false);
      const remaining = await pool.query<{ count: string }>(
        `select count(*)::text as count from connections
           where source_type = 'page' and source_id = $1 and target_id = $2`,
        [source.id, target.id],
      );
      expect(remaining.rows[0]?.count).toBe('0');
    } finally {
      server.hocuspocus.documents.delete(`page-meta:${owner.id}`);
      server.hocuspocus.documents.delete(`page-meta:${targetViewer.id}`);
    }
  });

  it('notifies target viewers when a backlink source is deleted', async () => {
    const owner = await createTestUser(pool);
    const targetViewer = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Deleted backlink source');
    const target = await createTestPage(pool, owner.id, 'Backlink target');
    await pool.query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
      [target.id, owner.id, targetViewer.id],
    );
    await pool.query(
      `insert into connections (
           source_type, source_id, target_type, target_id, target_slug,
           target_label, connection_type, link_text
         ) values ('page', $1, 'page', $2, 'backlink target',
                   'Backlink target', 'wikilink', 'Backlink target')`,
      [source.id, target.id],
    );
    const viewerMeta = new Document(`page-meta:${targetViewer.id}`);
    server.hocuspocus.documents.set(`page-meta:${targetViewer.id}`, viewerMeta);

    try {
      await pool.query(
        `update pages
           set is_deleted = true, deleted_at = now(), deletion_batch_id = gen_random_uuid()
           where id = $1`,
        [source.id],
      );
      await publishPageDeletion(server.hocuspocus, pool, source.id, mockLogger());

      expect(viewerMeta.getMap('backlinksVersion').get(target.id)).toEqual(expect.any(Number));
      expect(viewerMeta.getMap('backlinksVersion').has(source.id)).toBe(false);
    } finally {
      server.hocuspocus.documents.delete(`page-meta:${targetViewer.id}`);
    }
  });

  it('invalidates only active source documents that reference the renamed target', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Source');
    const unrelatedSource = await createTestPage(pool, owner.id, 'Unrelated source');
    const target = await createTestPage(pool, owner.id, 'Original target');
    await pool.query(
      `insert into connections (
           source_type, source_id, target_type, target_id, target_slug,
           target_label, connection_type, link_text
         ) values ('page', $1, 'page', $2, $3, 'Original target', 'wikilink', 'Wiki link')`,
      [source.id, target.id, `id:${target.id}`],
    );
    const session = await createTestSession(pool, owner.id);
    const messages: string[] = [];
    const unrelatedMessages: string[] = [];
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: source.id,
      document: new Y.Doc(),
      awareness: null,
      token: session.token,
      onStateless: ({ payload }) => messages.push(payload),
    });
    const unrelatedProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: unrelatedSource.id,
      document: new Y.Doc(),
      awareness: null,
      token: session.token,
      onStateless: ({ payload }) => unrelatedMessages.push(payload),
    });

    try {
      await waitFor(
        () => provider.synced && unrelatedProvider.synced,
        5_000,
        'wiki-link source providers to sync',
      );
      await pool.query('update pages set title = $1 where id = $2', ['Renamed target', target.id]);
      await publishPageRename(server.hocuspocus, pool, target.id, 'Renamed target', mockLogger());

      await waitFor(
        () =>
          messages.includes(
            JSON.stringify({
              type: 'wiki_link_presentations_changed',
              targetIds: [target.id],
            }),
          ),
        5_000,
        'wiki-link presentation invalidation',
      );
      expect(messages.join('\n')).not.toContain('Renamed target');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unrelatedMessages).not.toContainEqual(
        expect.stringContaining('wiki_link_presentations_changed'),
      );
    } finally {
      provider.destroy();
      unrelatedProvider.destroy();
    }
  });

  it('targets folder and workspace invalidations to matching linked pages', async () => {
    const owner = await createTestUser(pool);
    const source = await createTestPage(pool, owner.id, 'Source');
    const folderTarget = await createTestPage(pool, owner.id, 'Folder target');
    const rootTarget = await createTestPage(pool, owner.id, 'Root target');
    const folderId = crypto.randomUUID();
    await pool.query(
      `insert into folders (id, name, position, created_by, created_at, updated_at)
         values ($1, 'Target folder', '0', $2, now(), now())`,
      [folderId, owner.id],
    );
    await pool.query('update pages set parent_id = $1 where id = $2', [folderId, folderTarget.id]);
    await pool.query(
      `insert into connections (
           source_type, source_id, target_type, target_id, target_slug,
           target_label, connection_type, link_text
         ) values
           ('page', $1, 'page', $2, $4, 'Folder target', 'wikilink', 'Wiki link'),
           ('page', $1, 'page', $3, $5, 'Root target', 'wikilink', 'Wiki link')`,
      [source.id, folderTarget.id, rootTarget.id, `id:${folderTarget.id}`, `id:${rootTarget.id}`],
    );
    const session = await createTestSession(pool, owner.id);
    const messages: string[] = [];
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: source.id,
      document: new Y.Doc(),
      awareness: null,
      token: session.token,
      onStateless: ({ payload }) => messages.push(payload),
    });

    try {
      await waitFor(() => provider.synced, 5_000, 'wiki-link source provider to sync');
      await broadcastWikiLinkPresentationInvalidation(server.hocuspocus, pool, { folderId });
      await waitFor(
        () =>
          messages.includes(
            JSON.stringify({
              type: 'wiki_link_presentations_changed',
              targetIds: [folderTarget.id],
            }),
          ),
        5_000,
        'folder wiki-link invalidation',
      );

      messages.length = 0;
      await broadcastWikiLinkPresentationInvalidation(server.hocuspocus, pool, {
        workspaceOwnerId: owner.id,
      });
      await waitFor(
        () => messages.some((message) => message.includes('wiki_link_presentations_changed')),
        5_000,
        'workspace wiki-link invalidation',
      );
      const invalidation = messages
        .map((message) => JSON.parse(message) as { type?: string; targetIds?: string[] })
        .find((message) => message.type === 'wiki_link_presentations_changed');
      expect(invalidation?.targetIds).toHaveLength(2);
      expect(invalidation?.targetIds).toEqual(
        expect.arrayContaining([folderTarget.id, rootTarget.id]),
      );
    } finally {
      provider.destroy();
    }
  });
});
