import { HocuspocusProvider } from '@hocuspocus/provider';
import type { Document, Server } from '@hocuspocus/server';
import { getAnimalEmoji, getAnonymousName, getStableColor } from '@metakip/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { CollabSession } from './collabSession';
import { getSessionUser, isAnonymousSession } from './collabSession';
import { encodeAwarenessMessage } from './collabTestUtils';
import { createCollabServer } from './server';
import {
  canonicalTestAwarenessUser,
  createMockLogger as mockLogger,
  sleep,
  waitFor,
} from './serverTestHarness';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

describe('collab server awareness policy', () => {
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

  it('accepts the authenticated users non-null image as canonical awareness identity', async () => {
    const user = await createTestUser(pool);
    const image = 'https://cdn.example.com/test-user.png';
    await pool.query('update users set avatar_url = null, image = $1 where id = $2', [
      image,
      user.id,
    ]);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const source = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });
    const observer = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });

    try {
      await waitFor(() => source.synced && observer.synced, 5_000, 'image providers to sync');
      source.setAwarenessField('user', {
        ...canonicalTestAwarenessUser(user.id),
        avatar: image,
      });
      await waitFor(
        () =>
          Array.from(observer.awareness?.getStates().values() ?? []).some(
            (state) => state.user?.avatar === image,
          ),
        5_000,
        'canonical image awareness to propagate',
      );
    } finally {
      source.destroy();
      observer.destroy();
    }
  });

  it('prefers the Better Auth image when the legacy avatar differs', async () => {
    const user = await createTestUser(pool);
    const image = 'https://cdn.example.com/better-auth-image.png';
    await pool.query('update users set avatar_url = $1, image = $2 where id = $3', [
      'https://cdn.example.com/legacy-avatar.png',
      image,
      user.id,
    ]);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const source = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });
    const observer = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: new Y.Doc(),
      token: session.token,
    });

    try {
      await waitFor(() => source.synced && observer.synced, 5_000, 'avatar providers to sync');
      source.setAwarenessField('user', {
        ...canonicalTestAwarenessUser(user.id),
        avatar: image,
      });
      await waitFor(
        () =>
          Array.from(observer.awareness?.getStates().values() ?? []).some(
            (state) => state.user?.avatar === image,
          ),
        5_000,
        'Better Auth image awareness to propagate',
      );
    } finally {
      source.destroy();
      observer.destroy();
    }
  });

  it('keeps a third provider connected after bundled awareness sync', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const firstDocument = new Y.Doc();
    const secondDocument = new Y.Doc();
    const thirdDocument = new Y.Doc();
    const first = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: firstDocument,
      token: session.token,
    });
    const second = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: secondDocument,
      token: session.token,
    });
    const thirdClosed = vi.fn();
    let third: HocuspocusProvider | undefined;

    try {
      await waitFor(() => first.synced && second.synced, 5_000, 'source providers to sync');
      first.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      second.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      await waitFor(
        () =>
          first.awareness?.getStates().has(secondDocument.clientID) === true &&
          second.awareness?.getStates().has(firstDocument.clientID) === true,
        5_000,
        'two canonical awareness states to reach the server',
      );

      third = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: thirdDocument,
        token: session.token,
        onClose: thirdClosed,
      });
      await waitFor(
        () =>
          third?.synced === true &&
          third.awareness?.getStates().has(firstDocument.clientID) === true &&
          third.awareness?.getStates().has(secondDocument.clientID) === true,
        5_000,
        'third provider to receive bundled awareness',
      );
      const firstState = third.awareness?.getStates().get(firstDocument.clientID);
      const secondState = third.awareness?.getStates().get(secondDocument.clientID);
      const firstClock = third.awareness?.meta.get(firstDocument.clientID)?.clock;
      const secondClock = third.awareness?.meta.get(secondDocument.clientID)?.clock;
      if (
        firstState === undefined ||
        secondState === undefined ||
        firstClock === undefined ||
        secondClock === undefined
      ) {
        throw new Error('Missing bundled awareness state');
      }
      third.configuration.websocketProvider.webSocket?.send(
        encodeAwarenessMessage(page.id, [
          { clientId: firstDocument.clientID, clock: firstClock, state: firstState },
          { clientId: secondDocument.clientID, clock: secondClock, state: secondState },
        ]),
      );
      await sleep(100);
      expect(thirdClosed).not.toHaveBeenCalled();

      third.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      await waitFor(
        () => first.awareness?.getStates().has(thirdDocument.clientID) === true,
        5_000,
        'third provider awareness to propagate after initial sync',
      );
    } finally {
      first.destroy();
      second.destroy();
      third?.destroy();
    }
  });

  it('accepts a stale bundled echo that the server previously sent to a real provider', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const firstDocument = new Y.Doc();
    const secondDocument = new Y.Doc();
    const echoDocument = new Y.Doc();
    const first = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: firstDocument,
      token: session.token,
    });
    const second = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: secondDocument,
      token: session.token,
    });
    const echoClosed = vi.fn();
    let echo: HocuspocusProvider | undefined;

    try {
      await waitFor(() => first.synced && second.synced, 5_000, 'source providers to sync');
      first.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      second.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      await waitFor(
        () => {
          const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
          return (
            activeDocument?.awareness.getStates().has(firstDocument.clientID) === true &&
            activeDocument.awareness.getStates().has(secondDocument.clientID) === true
          );
        },
        5_000,
        'source awareness to reach the server',
      );

      echo = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: echoDocument,
        token: session.token,
        onClose: echoClosed,
      });
      await waitFor(
        () =>
          echo?.synced === true &&
          echo.awareness?.getStates().has(firstDocument.clientID) === true &&
          echo.awareness?.getStates().has(secondDocument.clientID) === true,
        5_000,
        'echo provider to receive bundled awareness',
      );

      const firstState = echo.awareness?.getStates().get(firstDocument.clientID);
      const secondState = echo.awareness?.getStates().get(secondDocument.clientID);
      const firstClock = echo.awareness?.meta.get(firstDocument.clientID)?.clock;
      const secondClock = echo.awareness?.meta.get(secondDocument.clientID)?.clock;
      if (
        firstState === undefined ||
        secondState === undefined ||
        firstClock === undefined ||
        secondClock === undefined
      ) {
        throw new Error('Missing server-delivered awareness bundle');
      }

      first.setAwarenessField('cursor', { anchor: 1, head: 1 });
      await waitFor(
        () => {
          const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
          return (
            (activeDocument?.awareness.meta.get(firstDocument.clientID)?.clock ?? 0) > firstClock
          );
        },
        5_000,
        'source awareness clock to advance',
      );

      echo.configuration.websocketProvider.webSocket?.send(
        encodeAwarenessMessage(page.id, [
          { clientId: firstDocument.clientID, clock: firstClock, state: firstState },
        ]),
      );
      await sleep(100);
      expect(echoClosed).not.toHaveBeenCalled();

      echo.configuration.websocketProvider.webSocket?.send(
        encodeAwarenessMessage(page.id, [
          { clientId: firstDocument.clientID, clock: firstClock, state: firstState },
          { clientId: secondDocument.clientID, clock: secondClock, state: secondState },
        ]),
      );
      await sleep(100);
      expect(echoClosed).not.toHaveBeenCalled();

      echo.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      echoDocument.getText('content').insert(0, 'write after stale awareness echo');
      await waitFor(
        () => firstDocument.getText('content').toString() === 'write after stale awareness echo',
        5_000,
        'write after stale awareness echo to converge',
      );
    } finally {
      first.destroy();
      second.destroy();
      echo?.destroy();
    }
  });

  it('allows duplicate providers for one authenticated Y.Doc client identity', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const sharedDocument = new Y.Doc();
    const observerDocument = new Y.Doc();
    const firstClosed = vi.fn();
    const duplicateClosed = vi.fn();
    const first = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: sharedDocument,
      token: session.token,
      onClose: firstClosed,
    });
    const duplicate = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: sharedDocument,
      token: session.token,
      onClose: duplicateClosed,
    });
    const observer = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: observerDocument,
      token: session.token,
    });

    try {
      await waitFor(
        () => first.synced && duplicate.synced && observer.synced,
        5_000,
        'duplicate providers to sync',
      );
      first.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      await waitFor(
        () =>
          observer.awareness?.getStates().get(sharedDocument.clientID)?.user?.name === 'Test User',
        5_000,
        'first duplicate awareness to propagate',
      );

      duplicate.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      duplicate.setAwarenessField('cursor', { anchor: 2, head: 2 });
      await waitFor(
        () => observer.awareness?.getStates().get(sharedDocument.clientID)?.cursor?.anchor === 2,
        5_000,
        'second duplicate awareness to propagate',
      );
      expect(firstClosed).not.toHaveBeenCalled();
      expect(duplicateClosed).not.toHaveBeenCalled();

      const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
      const clockBeforeDisconnect = activeDocument?.awareness.meta.get(
        sharedDocument.clientID,
      )?.clock;
      if (clockBeforeDisconnect === undefined) {
        throw new Error('Missing shared awareness clock before duplicate disconnect');
      }
      first.destroy();
      await waitFor(
        () => {
          const currentDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
          return (
            currentDocument?.awareness.getStates().has(sharedDocument.clientID) === true &&
            (currentDocument.awareness.meta.get(sharedDocument.clientID)?.clock ?? 0) ===
              clockBeforeDisconnect
          );
        },
        5_000,
        'remaining duplicate to retain awareness',
      );
      expect(duplicateClosed).not.toHaveBeenCalled();

      sharedDocument.getText('content').insert(0, 'duplicate provider write');
      await waitFor(
        () => observerDocument.getText('content').toString() === 'duplicate provider write',
        5_000,
        'duplicate provider write to converge',
      );
    } finally {
      first.destroy();
      duplicate.destroy();
      observer.destroy();
    }
  });

  it('rejects a different authenticated principal that reuses an active client identity', async () => {
    const owner = await createTestUser(pool);
    const intruder = await createTestUser(pool);
    const ownerSession = await createTestSession(pool, owner.id);
    const intruderSession = await createTestSession(pool, intruder.id);
    const page = await createTestPage(pool, owner.id);
    await pool.query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'edit')`,
      [page.id, owner.id, intruder.id],
    );
    const sharedDocument = new Y.Doc();
    const ownerClosed = vi.fn();
    const intruderClosed = vi.fn();
    const ownerProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: sharedDocument,
      token: ownerSession.token,
      onClose: ownerClosed,
    });
    let intruderProvider: HocuspocusProvider | undefined;

    try {
      await waitFor(() => ownerProvider.synced, 5_000, 'client identity owner to sync');
      ownerProvider.setAwarenessField('user', canonicalTestAwarenessUser(owner.id));
      await waitFor(
        () => {
          const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
          return (
            activeDocument?.awareness.getStates().get(sharedDocument.clientID)?.user?.name ===
            'Test User'
          );
        },
        5_000,
        'owned client identity to reach the server',
      );

      intruderProvider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: sharedDocument,
        awareness: null,
        token: intruderSession.token,
        onClose: intruderClosed,
      });
      await waitFor(() => intruderProvider?.synced === true, 5_000, 'intruder provider to sync');
      const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
      const intruderConnection = activeDocument?.getConnections().find((connection) => {
        const connectionContext = connection.context as CollabSession | undefined;
        return connectionContext?.principal && getSessionUser(connectionContext).id === intruder.id;
      });
      if (!activeDocument || !intruderConnection) {
        throw new Error('Missing intruder awareness connection');
      }
      const currentClock = activeDocument.awareness.meta.get(sharedDocument.clientID)?.clock;
      if (currentClock === undefined) throw new Error('Missing owned awareness clock');
      const intruderServerClose = vi.spyOn(intruderConnection, 'close');
      try {
        intruderProvider.configuration.websocketProvider.webSocket?.send(
          encodeAwarenessMessage(page.id, [
            {
              clientId: sharedDocument.clientID,
              clock: currentClock + 1,
              state: { user: canonicalTestAwarenessUser(intruder.id) },
            },
          ]),
        );
        await waitFor(
          () =>
            intruderClosed.mock.calls.length > 0 &&
            intruderServerClose.mock.calls.some((call) => call[0]?.code === 4403),
          5_000,
          'cross-principal client identity reuse to close',
        );
      } finally {
        intruderServerClose.mockRestore();
      }

      expect(ownerClosed).not.toHaveBeenCalled();
      expect(activeDocument.awareness.getStates().get(sharedDocument.clientID)?.user).toEqual(
        canonicalTestAwarenessUser(owner.id),
      );
    } finally {
      ownerProvider.destroy();
      intruderProvider?.destroy();
    }
  });

  it('rejects an anonymous principal that reuses an authenticated client identity', async () => {
    const owner = await createTestUser(pool);
    const ownerSession = await createTestSession(pool, owner.id);
    const page = await createTestPage(pool, owner.id);
    await pool.query("update pages set public_permission = 'view' where id = $1", [page.id]);
    const sharedDocument = new Y.Doc();
    const ownerClosed = vi.fn();
    const anonymousClosed = vi.fn();
    const ownerProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: sharedDocument,
      token: ownerSession.token,
      onClose: ownerClosed,
    });
    let anonymousProvider: HocuspocusProvider | undefined;

    try {
      await waitFor(() => ownerProvider.synced, 5_000, 'authenticated identity owner to sync');
      ownerProvider.setAwarenessField('user', canonicalTestAwarenessUser(owner.id));
      await waitFor(
        () => {
          const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
          return activeDocument?.awareness.getStates().has(sharedDocument.clientID) === true;
        },
        5_000,
        'authenticated client identity to reach the server',
      );

      anonymousProvider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: sharedDocument,
        awareness: null,
        token: `anon:${owner.id}`,
        onClose: anonymousClosed,
      });
      await waitFor(
        () => anonymousProvider?.synced === true,
        5_000,
        'anonymous collision provider to sync',
      );
      const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
      const anonymousConnection = activeDocument?.getConnections().find((connection) => {
        const connectionContext = connection.context as CollabSession | undefined;
        return (
          connectionContext?.principal &&
          getSessionUser(connectionContext).id === owner.id &&
          isAnonymousSession(connectionContext)
        );
      });
      const currentClock = activeDocument?.awareness.meta.get(sharedDocument.clientID)?.clock;
      if (!activeDocument || !anonymousConnection || currentClock === undefined) {
        throw new Error('Missing anonymous collision connection');
      }
      const anonymousServerClose = vi.spyOn(anonymousConnection, 'close');
      try {
        anonymousProvider.configuration.websocketProvider.webSocket?.send(
          encodeAwarenessMessage(page.id, [
            {
              clientId: sharedDocument.clientID,
              clock: currentClock + 1,
              state: {
                user: {
                  name: getAnonymousName(owner.id),
                  color: getStableColor(owner.id),
                  avatar: null,
                  emoji: getAnimalEmoji(owner.id),
                  isAnonymous: true,
                },
              },
            },
          ]),
        );
        await waitFor(
          () =>
            anonymousClosed.mock.calls.length > 0 &&
            anonymousServerClose.mock.calls.some((call) => call[0]?.code === 4403),
          5_000,
          'anonymous client identity collision to close',
        );
      } finally {
        anonymousServerClose.mockRestore();
      }

      expect(ownerClosed).not.toHaveBeenCalled();
      expect(activeDocument.awareness.getStates().get(sharedDocument.clientID)?.user).toEqual(
        canonicalTestAwarenessUser(owner.id),
      );
    } finally {
      ownerProvider.destroy();
      anonymousProvider?.destroy();
    }
  });

  it('rejects forged user fields from a same-principal duplicate provider', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const sharedDocument = new Y.Doc();
    const firstClosed = vi.fn();
    const duplicateClosed = vi.fn();
    const first = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: sharedDocument,
      token: session.token,
      onClose: firstClosed,
    });
    let duplicate: HocuspocusProvider | undefined;

    try {
      await waitFor(() => first.synced, 5_000, 'forgery source provider to sync');
      first.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      await waitFor(
        () => {
          const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
          return activeDocument?.awareness.getStates().has(sharedDocument.clientID) === true;
        },
        5_000,
        'forgery source awareness to reach the server',
      );

      duplicate = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: sharedDocument,
        token: session.token,
        onClose: duplicateClosed,
      });
      await waitFor(() => duplicate?.synced === true, 5_000, 'forgery duplicate to sync');
      const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
      const closeSpies = (activeDocument?.getConnections() ?? []).map((connection) =>
        vi.spyOn(connection, 'close'),
      );
      try {
        duplicate.setAwarenessField('user', {
          ...canonicalTestAwarenessUser(user.id),
          name: 'Forged Same Principal',
        });
        await waitFor(
          () =>
            duplicateClosed.mock.calls.length > 0 &&
            closeSpies.some((spy) => spy.mock.calls.some((call) => call[0]?.code === 4403)),
          5_000,
          'same-principal forged user to close',
        );
      } finally {
        for (const closeSpy of closeSpies) closeSpy.mockRestore();
      }

      expect(firstClosed).not.toHaveBeenCalled();
      expect(activeDocument?.awareness.getStates().get(sharedDocument.clientID)?.user).toEqual(
        canonicalTestAwarenessUser(user.id),
      );
    } finally {
      first.destroy();
      duplicate?.destroy();
    }
  });

  it('rejects null removal from an unbound same-principal duplicate', async () => {
    const user = await createTestUser(pool);
    const session = await createTestSession(pool, user.id);
    const page = await createTestPage(pool, user.id);
    const sharedDocument = new Y.Doc();
    const firstClosed = vi.fn();
    const duplicateClosed = vi.fn();
    const first = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: sharedDocument,
      token: session.token,
      onClose: firstClosed,
    });
    let duplicate: HocuspocusProvider | undefined;

    try {
      await waitFor(() => first.synced, 5_000, 'null-removal source to sync');
      first.setAwarenessField('user', canonicalTestAwarenessUser(user.id));
      await waitFor(
        () => {
          const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
          return activeDocument?.awareness.getStates().has(sharedDocument.clientID) === true;
        },
        5_000,
        'null-removal source awareness to reach the server',
      );

      duplicate = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: sharedDocument,
        awareness: null,
        token: session.token,
        onClose: duplicateClosed,
      });
      await waitFor(() => duplicate?.synced === true, 5_000, 'unbound duplicate to sync');
      const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
      const unboundConnection = activeDocument?.getConnections().find((connection) => {
        const connectionContext = connection.context as CollabSession | undefined;
        return (
          connectionContext?.principal &&
          getSessionUser(connectionContext).id === user.id &&
          connectionContext.lifecycle.awareness.clientId === undefined
        );
      });
      const currentClock = activeDocument?.awareness.meta.get(sharedDocument.clientID)?.clock;
      if (!activeDocument || !unboundConnection || currentClock === undefined) {
        throw new Error('Missing unbound same-principal duplicate');
      }
      const duplicateServerClose = vi.spyOn(unboundConnection, 'close');
      try {
        duplicate.configuration.websocketProvider.webSocket?.send(
          encodeAwarenessMessage(page.id, [
            { clientId: sharedDocument.clientID, clock: currentClock + 1, state: null },
          ]),
        );
        await waitFor(
          () =>
            duplicateClosed.mock.calls.length > 0 &&
            duplicateServerClose.mock.calls.some((call) => call[0]?.code === 4403),
          5_000,
          'unbound duplicate null removal to close',
        );
      } finally {
        duplicateServerClose.mockRestore();
      }

      expect(firstClosed).not.toHaveBeenCalled();
      expect(activeDocument.awareness.getStates().has(sharedDocument.clientID)).toBe(true);
    } finally {
      first.destroy();
      duplicate?.destroy();
    }
  });

  it('binds raw awareness updates to one authenticated client identity', async () => {
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
    const ownerDocument = new Y.Doc();
    const ownerProvider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: page.id,
      document: ownerDocument,
      token: ownerSession.token,
    });
    const attackers: HocuspocusProvider[] = [];

    const sendAdversarialAwareness = async (
      createMessage: (attackerDocument: Y.Doc) => Uint8Array,
    ): Promise<void> => {
      const attackerDocument = new Y.Doc();
      const closed = vi.fn();
      const provider = new HocuspocusProvider({
        url: `ws://localhost:${port}`,
        name: page.id,
        document: attackerDocument,
        token: attackerSession.token,
        onClose: closed,
      });
      attackers.push(provider);
      await waitFor(() => provider.synced, 10_000, 'awareness attacker to sync');
      const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
      await waitFor(
        () =>
          activeDocument?.getConnections().some((connection) => {
            const connectionContext = connection.context as CollabSession | undefined;
            return (
              connectionContext?.principal.kind === 'account' &&
              getSessionUser(connectionContext).id === attacker.id &&
              connectionContext.lifecycle.awareness.clientId === attackerDocument.clientID
            );
          }) === true,
        5_000,
        'current awareness attacker connection to become identifiable',
      );
      const serverConnection = activeDocument?.getConnections().find((connection) => {
        const connectionContext = connection.context as CollabSession | undefined;
        return (
          connectionContext?.principal.kind === 'account' &&
          getSessionUser(connectionContext).id === attacker.id &&
          connectionContext.lifecycle.awareness.clientId === attackerDocument.clientID
        );
      });
      if (!serverConnection) throw new Error('Missing server-side attacker connection');
      const serverClose = vi.spyOn(serverConnection, 'close');

      try {
        provider.configuration.websocketProvider.webSocket?.send(createMessage(attackerDocument));
        await waitFor(
          () =>
            closed.mock.calls.length > 0 &&
            serverClose.mock.calls.some((call) => call[0]?.code === 4403),
          10_000,
          'invalid awareness sender to close with server code 4403',
        );
        expect(serverClose).toHaveBeenCalledWith(expect.objectContaining({ code: 4403 }));
      } finally {
        serverClose.mockRestore();
        provider.destroy();
      }
    };

    try {
      await waitFor(() => ownerProvider.synced, 5_000, 'awareness owner to sync');
      ownerProvider.setAwarenessField('user', canonicalTestAwarenessUser(owner.id));
      await waitFor(
        () => {
          const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
          const state = activeDocument?.awareness.getStates().get(ownerDocument.clientID) as
            | { user?: { name?: string } }
            | undefined;
          return (
            state?.user?.name === 'Test User' &&
            activeDocument?.awareness.meta.get(ownerDocument.clientID)?.clock !== undefined
          );
        },
        5_000,
        'owner canonical awareness state and clock to reach the server',
      );
      const activeDocument = server.hocuspocus.documents.get(page.id) as Document | undefined;
      const ownerAwarenessState = activeDocument?.awareness.getStates().get(ownerDocument.clientID);
      const ownerAwarenessClock = activeDocument?.awareness.meta.get(ownerDocument.clientID)?.clock;
      if (ownerAwarenessState === undefined || ownerAwarenessClock === undefined) {
        throw new Error('Missing server-owned awareness state');
      }

      await sendAdversarialAwareness((attackerDocument) =>
        encodeAwarenessMessage(page.id, [
          {
            clientId: ownerDocument.clientID,
            clock: ownerAwarenessClock,
            state: ownerAwarenessState,
          },
          {
            clientId: attackerDocument.clientID,
            clock: 100,
            state: {
              user: { name: 'Forged Owner', color: '#000000', avatar: 'forged.png' },
            },
          },
        ]),
      );
      await sendAdversarialAwareness((attackerDocument) =>
        encodeAwarenessMessage(page.id, [
          {
            clientId: attackerDocument.clientID,
            clock: 100,
            state: {
              user: { name: 'Forged Owner', color: '#000000', avatar: 'forged.png' },
            },
          },
        ]),
      );
      await sendAdversarialAwareness(() =>
        encodeAwarenessMessage(page.id, [
          {
            clientId: ownerDocument.clientID,
            clock: ownerAwarenessClock + 1,
            state: { user: canonicalTestAwarenessUser(owner.id) },
          },
        ]),
      );
      await sendAdversarialAwareness(() =>
        encodeAwarenessMessage(page.id, [
          {
            clientId: ownerDocument.clientID,
            clock: ownerAwarenessClock,
            state: {
              user: canonicalTestAwarenessUser(attacker.id),
            },
          },
        ]),
      );
      await sendAdversarialAwareness(() =>
        encodeAwarenessMessage(page.id, [
          {
            clientId: ownerDocument.clientID,
            clock: ownerAwarenessClock + 2,
            state: null,
          },
        ]),
      );

      await sleep(50);
      expect(ownerProvider.awareness?.getStates().get(ownerDocument.clientID)?.user).toEqual(
        canonicalTestAwarenessUser(owner.id),
      );
      const awarenessUsers = Array.from(ownerProvider.awareness?.getStates().values() ?? [])
        .map((state) => state.user as { name?: string } | undefined)
        .filter(Boolean);
      expect(awarenessUsers).not.toContainEqual(expect.objectContaining({ name: 'Forged Owner' }));
    } finally {
      for (const provider of attackers) provider.destroy();
      ownerProvider.destroy();
    }
  });
});
