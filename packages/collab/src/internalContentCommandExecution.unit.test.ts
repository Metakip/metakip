import { createHash, randomUUID } from 'node:crypto';
import type { Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import { composePageMarkdown } from '@markdawn/shared';
import { bindWikiLinkTargets, createYjsDocWithTitle } from '@markdawn/shared/markdown-yjs';
import { replaceMarkdownBody } from '@markdawn/shared/yjs-document-replacement';
import { extractWikiLinkTargetIds, yDocToMarkdown } from '@markdawn/shared/yjs-helpers';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { DocumentPersistenceMutation } from './contentMutationPersistence';
import { ContentConflictError } from './internalContentCommandErrors';
import {
  type InternalContentCommandOptions,
  withAuthorizedPageDocument,
} from './internalContentCommandExecution';

describe('withAuthorizedPageDocument', () => {
  function etagFor(state: Uint8Array): string {
    const markdown = composePageMarkdown(yDocToMarkdown(state), null, null);
    return `"${createHash('sha256').update(markdown).digest('base64url')}"`;
  }

  function extractBoundTargetId(document: Y.Doc): string | undefined {
    return extractWikiLinkTargetIds(Y.encodeStateAsUpdate(document))[0];
  }

  type WikiLinkRow = { pageId: string; title: string; pagePath: string | null };

  function mutationHarness(
    initialBody: string,
    committedBody?: string,
    wikiLinkRows: WikiLinkRow[] = [],
    tokenId: string | null = null,
  ) {
    const userId = randomUUID();
    const pageId = randomUUID();
    const document = new Y.Doc();
    Y.applyUpdate(document, createYjsDocWithTitle('Page', initialBody));
    let committedState: Uint8Array | undefined;
    let persistedMutation: DocumentPersistenceMutation | undefined;
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('from users')) {
        return {
          rows: [{ id: userId, email: 'agent@example.test', name: 'Agent', avatarUrl: null }],
        };
      }
      if (statement.includes('select title, properties, icon')) {
        return {
          rows: [{ title: 'Page', properties: null, icon: null, workspaceOwnerId: userId }],
        };
      }
      if (statement.includes('with recursive enumerable_folders')) {
        return { rows: wikiLinkRows };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    const effectsQuery = vi.fn(async (_statement: string, _params?: readonly unknown[]) => ({
      rows: [],
      rowCount: 1,
    }));
    const releaseEffectsClient = vi.fn();
    const options: InternalContentCommandOptions = {
      pool: {
        query,
        connect: vi.fn(async () => ({ query: effectsQuery, release: releaseEffectsClient })),
      } as unknown as Pool,
      hocuspocus: {
        openDirectConnection: vi.fn(async () => ({ document, disconnect: vi.fn() })),
      } as unknown as Hocuspocus,
      access: {
        assertPageAccess: vi.fn(async () => ({
          permission: 'edit' as const,
          accessRevision: 'revision',
        })),
      },
      logger: { warn: vi.fn() } as unknown as Logger,
      rejectLiveMutation: vi.fn(),
      tryAcquireContentCommand: vi.fn(() => () => undefined),
      withDocumentMutationGate: async (_pageId, task) => task(),
      withDocumentContentLock: async (_lockedPageId, task) => task(),
      flushDocument: vi.fn(async (_id, liveDocument, _context, _source, mutation) => {
        persistedMutation = mutation;
        if (committedBody !== undefined) {
          replaceMarkdownBody(liveDocument, 'Page', committedBody);
        }
        committedState = Y.encodeStateAsUpdate(liveDocument);
        mutation?.prepareCommittedState?.(committedState);
        return { status: 'persisted' as const, state: committedState };
      }),
    };
    return {
      committedState: () => {
        if (!committedState) throw new Error('The committed state is unavailable');
        return committedState;
      },
      document,
      effectsQuery,
      options,
      pageId,
      principal: {
        userId,
        requestId: randomUUID(),
        tokenId,
        idempotencyPrincipal: `session:${randomUUID()}`,
      },
      persistedMutation: () => persistedMutation,
    };
  }

  it('loads metadata while holding the document content lock', async () => {
    const userId = randomUUID();
    const pageId = randomUUID();
    const document = new Y.Doc();
    let lockActive = false;
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('from users')) {
        return {
          rows: [{ id: userId, email: 'agent@example.test', name: 'Agent', avatarUrl: null }],
        };
      }
      if (statement.includes('select title, properties, icon')) {
        expect(lockActive).toBe(true);
        return {
          rows: [{ title: 'Locked page', properties: null, icon: null, workspaceOwnerId: userId }],
        };
      }
      if (statement.includes('with recursive enumerable_folders')) {
        expect(lockActive).toBe(true);
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });
    const disconnect = vi.fn(async () => undefined);
    const options: InternalContentCommandOptions = {
      pool: { query } as unknown as Pool,
      hocuspocus: {
        openDirectConnection: vi.fn(async () => ({ document, disconnect })),
      } as unknown as Hocuspocus,
      access: {
        assertPageAccess: vi.fn(async () => ({
          permission: 'edit' as const,
          accessRevision: 'revision',
        })),
      },
      logger: { warn: vi.fn() } as unknown as Logger,
      rejectLiveMutation: vi.fn(),
      tryAcquireContentCommand: vi.fn(() => () => undefined),
      withDocumentMutationGate: async (_pageId, task) => task(),
      withDocumentContentLock: async (_lockedPageId, task) => {
        lockActive = true;
        try {
          return await task();
        } finally {
          lockActive = false;
        }
      },
      flushDocument: vi.fn(async () => ({
        status: 'persisted' as const,
        state: Y.encodeStateAsUpdate(document),
      })),
    };

    const result = await withAuthorizedPageDocument(
      options,
      pageId,
      {
        userId,
        requestId: randomUUID(),
        tokenId: null,
        idempotencyPrincipal: `session:${randomUUID()}`,
      },
      { action: 'read-markdown' },
    );

    expect(result).toMatchObject({ markdown: '', etag: expect.any(String) });
    expect(disconnect).toHaveBeenCalledOnce();
    document.destroy();
  });

  it('holds the REST mutation gate through persistence', async () => {
    const harness = mutationHarness('Before');
    let mutationGateActive = false;
    harness.options.withDocumentMutationGate = async (_pageId, task) => {
      mutationGateActive = true;
      try {
        return await task();
      } finally {
        mutationGateActive = false;
      }
    };
    harness.options.flushDocument = vi.fn(async (_id, document) => {
      expect(mutationGateActive).toBe(true);
      return { status: 'persisted' as const, state: Y.encodeStateAsUpdate(document) };
    });

    await withAuthorizedPageDocument(harness.options, harness.pageId, harness.principal, {
      action: 'replace-markdown',
      markdown: 'After',
      ifMatch: etagFor(Y.encodeStateAsUpdate(harness.document)),
    });

    expect(mutationGateActive).toBe(false);
    harness.document.destroy();
  });

  it('rejects excess work before opening a direct connection', async () => {
    const openDirectConnection = vi.fn();
    const options = {
      tryAcquireContentCommand: vi.fn(() => null),
      hocuspocus: { openDirectConnection },
    } as unknown as InternalContentCommandOptions;

    await expect(
      withAuthorizedPageDocument(
        options,
        randomUUID(),
        {
          userId: randomUUID(),
          requestId: randomUUID(),
          tokenId: null,
          idempotencyPrincipal: `session:${randomUUID()}`,
        },
        { action: 'read-markdown' },
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: 'collaboration_busy',
      retryAfterSeconds: 1,
    });
    expect(openDirectConnection).not.toHaveBeenCalled();
  });

  it('returns a replacement ETag for the state committed by persistence', async () => {
    const harness = mutationHarness('Before', 'Replacement plus browser update');
    const response = await withAuthorizedPageDocument(
      harness.options,
      harness.pageId,
      harness.principal,
      {
        action: 'replace-markdown',
        markdown: 'Replacement',
        ifMatch: etagFor(Y.encodeStateAsUpdate(harness.document)),
      },
    );

    expect(response).toEqual({ etag: etagFor(harness.committedState()) });
    harness.document.destroy();
  });

  it('audits a stale token-backed whole-page replacement as a conflict', async () => {
    const tokenId = randomUUID();
    const harness = mutationHarness('Before', undefined, [], tokenId);

    await expect(
      withAuthorizedPageDocument(harness.options, harness.pageId, harness.principal, {
        action: 'replace-markdown',
        markdown: 'After',
        ifMatch: '"stale"',
      }),
    ).rejects.toBeInstanceOf(ContentConflictError);

    const auditCall = harness.effectsQuery.mock.calls.find(([statement]) =>
      statement.includes('insert into api_token_audit_events'),
    );
    expect(auditCall?.[1]).toEqual([
      tokenId,
      harness.principal.userId,
      harness.pageId,
      'page.content.replace',
      'conflict',
    ]);
    expect(harness.options.flushDocument).not.toHaveBeenCalled();
    harness.document.destroy();
  });

  it('stores and returns the exact-edit ETag for the committed state', async () => {
    const harness = mutationHarness('Before', 'After plus browser update');
    const response = await withAuthorizedPageDocument(
      harness.options,
      harness.pageId,
      harness.principal,
      {
        action: 'apply-exact-edits',
        command: {
          edits: [{ id: 'edit', oldText: 'Before', newText: 'After' }],
          idempotency: {
            recordId: randomUUID(),
            key: 'same-key',
            requestHash: 'request-hash',
          },
        },
      },
    );
    const expectedEtag = etagFor(harness.committedState());

    expect(response).toMatchObject({ etag: expectedEtag });
    expect(harness.persistedMutation()?.idempotency?.response.etag).toBe(expectedEtag);
    harness.document.destroy();
  });

  it.each([
    ['append', 'Existing\n\nAdded'] as const,
    ['prepend', 'Added\n\nExisting'] as const,
  ])('applies %s against the latest document and stores its idempotent response', async (operation, expected) => {
    const harness = mutationHarness('Existing');
    const response = await withAuthorizedPageDocument(
      harness.options,
      harness.pageId,
      harness.principal,
      {
        action: 'apply-content-boundary-operation',
        command: {
          id: operation,
          operation,
          content: 'Added',
          idempotency: {
            recordId: randomUUID(),
            key: 'same-key',
            requestHash: 'request-hash',
          },
        },
      },
    );

    expect(response).toMatchObject({ id: operation, etag: etagFor(harness.committedState()) });
    expect(yDocToMarkdown(harness.committedState())).toBe(expected);
    expect(harness.persistedMutation()?.idempotency?.response).toMatchObject({ id: operation });
    harness.document.destroy();
  });

  it('appends after an unrelated browser edit that wins the content lock first', async () => {
    const harness = mutationHarness('Existing');
    harness.options.withDocumentContentLock = async (_pageId, task) => {
      replaceMarkdownBody(harness.document, 'Page', 'Browser change', null);
      return task();
    };

    await withAuthorizedPageDocument(harness.options, harness.pageId, harness.principal, {
      action: 'apply-content-boundary-operation',
      command: { id: 'append', operation: 'append', content: 'Added' },
    });

    expect(yDocToMarkdown(harness.committedState())).toBe('Browser change\n\nAdded');
    harness.document.destroy();
  });

  it('rejects CRLF-only boundary content before persisting an append', async () => {
    const harness = mutationHarness('Existing');

    await expect(
      withAuthorizedPageDocument(harness.options, harness.pageId, harness.principal, {
        action: 'apply-content-boundary-operation',
        command: { id: 'append', operation: 'append', content: '\r\n' },
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'Content must contain Markdown after boundary normalization',
    });
    expect(harness.options.flushDocument).not.toHaveBeenCalled();
    harness.document.destroy();
  });

  it.each([
    ['prepend', 'Existing'] as const,
    ['append', ''] as const,
  ])('%s preserves frontmatter-looking input as authored body text', async (operation, initialBody) => {
    const harness = mutationHarness(initialBody);
    const boundaryContent = '---\nicon: boundary\nstatus: draft\n---\nBoundary content';

    await withAuthorizedPageDocument(harness.options, harness.pageId, harness.principal, {
      action: 'apply-content-boundary-operation',
      command: { id: operation, operation, content: boundaryContent },
    });

    const markdown = yDocToMarkdown(harness.committedState());
    expect(markdown).toContain('icon: boundary');
    expect(markdown).toContain('status: draft');
    expect(markdown).toContain('Boundary content');
    expect(harness.persistedMutation()?.metadata).toEqual({ properties: null, icon: null });
    harness.document.destroy();
  });

  it('renders accessible bound links and protects inaccessible targets', async () => {
    const targetId = randomUUID();
    const accessible = mutationHarness('', undefined, [
      { pageId: targetId, title: 'Renamed target', pagePath: null },
    ]);
    Y.applyUpdate(
      accessible.document,
      bindWikiLinkTargets(
        createYjsDocWithTitle('Page', '[[Original target]]'),
        new Map([['original target', targetId]]),
      ),
    );
    const accessibleResponse = await withAuthorizedPageDocument(
      accessible.options,
      accessible.pageId,
      accessible.principal,
      { action: 'read-markdown' },
    );
    expect(accessibleResponse).toMatchObject({ markdown: '[[Renamed target]]' });
    accessible.document.destroy();

    const restricted = mutationHarness('');
    Y.applyUpdate(
      restricted.document,
      bindWikiLinkTargets(
        createYjsDocWithTitle('Page', '[[Original target]]'),
        new Map([['original target', targetId]]),
      ),
    );
    const restrictedResponse = await withAuthorizedPageDocument(
      restricted.options,
      restricted.pageId,
      restricted.principal,
      { action: 'read-markdown' },
    );
    expect(restrictedResponse).toMatchObject({ markdown: 'Restricted page' });
    restricted.document.destroy();
  });

  it.each([
    ['replacement', 'replace-markdown'] as const,
    ['exact edit', 'apply-exact-edits'] as const,
  ])('binds links introduced by a %s and follows target renames', async (_label, action) => {
    const targetId = randomUUID();
    const target = { pageId: targetId, title: 'Target', pagePath: null };
    const harness = mutationHarness('Before', undefined, [target]);
    const command =
      action === 'replace-markdown'
        ? {
            action,
            markdown: '[[Target]]',
            ifMatch: etagFor(Y.encodeStateAsUpdate(harness.document)),
          }
        : {
            action,
            command: { edits: [{ id: 'link', oldText: 'Before', newText: '[[Target]]' }] },
          };

    await withAuthorizedPageDocument(harness.options, harness.pageId, harness.principal, command);
    expect(extractBoundTargetId(harness.document)).toBe(targetId);

    target.title = 'Renamed target';
    const readResponse = await withAuthorizedPageDocument(
      harness.options,
      harness.pageId,
      harness.principal,
      { action: 'read-markdown' },
    );
    expect(readResponse).toMatchObject({ markdown: '[[Renamed target]]' });
    harness.document.destroy();
  });

  it.each([
    ['replacement', 'replace-markdown'] as const,
    ['exact edit', 'apply-exact-edits'] as const,
  ])('rejects a %s when an inaccessible bound link cannot round-trip', async (_label, action) => {
    const targetId = randomUUID();
    const harness = mutationHarness('[[Hidden target]]\n\nBefore');
    Y.applyUpdate(
      harness.document,
      bindWikiLinkTargets(
        Y.encodeStateAsUpdate(harness.document),
        new Map([['hidden target', targetId]]),
      ),
    );
    const read = (await withAuthorizedPageDocument(
      harness.options,
      harness.pageId,
      harness.principal,
      { action: 'read-markdown' },
    )) as { markdown: string; etag: string };
    expect(read.markdown).toContain('Restricted page');
    const command =
      action === 'replace-markdown'
        ? { action, markdown: read.markdown.replace('Before', 'After'), ifMatch: read.etag }
        : {
            action,
            command: { edits: [{ id: 'body', oldText: 'Before', newText: 'After' }] },
          };

    await expect(
      withAuthorizedPageDocument(harness.options, harness.pageId, harness.principal, command),
    ).rejects.toMatchObject({ status: 409, code: 'unsafe_wiki_link_rewrite' });
    expect(extractBoundTargetId(harness.document)).toBe(targetId);
    harness.document.destroy();
  });

  it.each([
    ['replacement', 'replace-markdown'] as const,
    ['exact edit', 'apply-exact-edits'] as const,
  ])('preserves a path-qualified duplicate-title link during a %s', async (_label, action) => {
    const targetId = randomUUID();
    const otherTargetId = randomUUID();
    const rows = [
      { pageId: targetId, title: 'Target', pagePath: 'Folder A/Target' },
      { pageId: otherTargetId, title: 'Target', pagePath: 'Folder B/Target' },
    ];
    const harness = mutationHarness('[[Folder A/Target]]\n\nBefore', undefined, rows);
    Y.applyUpdate(
      harness.document,
      bindWikiLinkTargets(
        Y.encodeStateAsUpdate(harness.document),
        new Map([['folder a/target', targetId]]),
      ),
    );
    const read = (await withAuthorizedPageDocument(
      harness.options,
      harness.pageId,
      harness.principal,
      { action: 'read-markdown' },
    )) as { markdown: string; etag: string };
    expect(read.markdown).toContain('[[Folder A/Target]]');
    const command =
      action === 'replace-markdown'
        ? { action, markdown: read.markdown.replace('Before', 'After'), ifMatch: read.etag }
        : {
            action,
            command: { edits: [{ id: 'body', oldText: 'Before', newText: 'After' }] },
          };

    await withAuthorizedPageDocument(harness.options, harness.pageId, harness.principal, command);
    expect(extractBoundTargetId(harness.document)).toBe(targetId);
    harness.document.destroy();
  });
});
