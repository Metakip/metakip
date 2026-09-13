import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Server } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import { getAnimalEmoji, getAnonymousName, getStableColor } from '@metakip/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createCollabServer } from './server';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createLogger(): Logger {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

describe('collaboration providers', () => {
  const pool = getTestPool();
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger: createLogger(),
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

  it('keeps an anonymous view-only provider subscribed after a local normalization update', async () => {
    const owner = await createTestUser(pool);
    const ownerSession = await createTestSession(pool, owner.id);
    const page = await createTestPage(pool, owner.id);
    await pool.query("update pages set public_permission = 'view' where id = $1", [page.id]);
    const anonymousId = crypto.randomUUID();
    const ownerDocument = new Y.Doc();
    const viewerDocument = new Y.Doc();
    const ownerClosed = vi.fn();
    const viewerClosed = vi.fn();
    const ownerProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: ownerDocument,
      token: ownerSession.token,
      onClose: ownerClosed,
    });
    const viewerProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: viewerDocument,
      token: `anon:${anonymousId}`,
      forceSyncInterval: 100,
      onClose: viewerClosed,
    });

    try {
      await waitFor(
        () => ownerProvider.synced && viewerProvider.synced,
        5_000,
        'owner and anonymous viewer to sync',
      );
      ownerProvider.setAwarenessField('user', {
        name: 'Test User',
        color: getStableColor(owner.id),
        avatar: null,
      });
      viewerProvider.setAwarenessField('user', {
        name: getAnonymousName(anonymousId),
        color: getStableColor(anonymousId),
        avatar: null,
        emoji: getAnimalEmoji(anonymousId),
        isAnonymous: true,
      });
      await waitFor(
        () =>
          ownerProvider.awareness?.getStates().has(viewerDocument.clientID) === true &&
          viewerProvider.awareness?.getStates().has(ownerDocument.clientID) === true,
        5_000,
        'owner and anonymous viewer awareness to propagate',
      );

      // A read-only binding may still emit local normalization updates.
      // They must be rejected without removing the viewer subscription.
      viewerDocument.getMap('viewer-normalization').set('local', true);
      await sleep(250);
      const activeDocument = server.hocuspocus.documents.get(page.id);
      expect(activeDocument?.getMap('viewer-normalization').has('local')).toBe(false);
      expect(viewerClosed).not.toHaveBeenCalled();

      ownerDocument.getText('content').insert(0, 'live owner update');
      await waitFor(
        () => viewerDocument.getText('content').toString() === 'live owner update',
        5_000,
        'anonymous viewer to receive the owner update',
      );
      expect(viewerProvider.awareness?.getStates().has(ownerDocument.clientID)).toBe(true);
      expect(ownerClosed).not.toHaveBeenCalled();
      expect(viewerClosed).not.toHaveBeenCalled();
    } finally {
      ownerProvider.destroy();
      viewerProvider.destroy();
    }
  });
});
