import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  Connection,
  type ConnectionConfiguration,
  Document,
  type onAuthenticatePayload,
  type onDisconnectPayload,
  type Server,
} from '@hocuspocus/server';
import type { getLogger } from '@logtape/logtape';
import { getAnonymousName, getStableColor } from '@metakip/shared';
import { vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import type { CollabSession } from './collabSession';
import { createCollabSession } from './collabSession';
import { concatBytes, encodeVarUint } from './collabTestUtils';
import { createConnectionLifecycle } from './connectionLifecycle';
import { createTestSession, type getTestPool } from './test-utils';

export async function createAccountHookContext(
  pool: ReturnType<typeof getTestPool>,
  userId: string,
  permission: CollabSession['permission'] = 'admin',
): Promise<CollabSession> {
  const session = await createTestSession(pool, userId);
  return createUnverifiedAccountHookContext(userId, permission, session.token);
}

export function createUnverifiedAccountHookContext(
  userId: string,
  permission: CollabSession['permission'] = 'admin',
  sessionToken = `test-session:${userId}`,
): CollabSession {
  return createCollabSession({
    principal: {
      kind: 'account',
      user: {
        id: userId,
        email: `${userId}@example.com`,
        name: 'Test User',
        avatarUrl: null,
      },
      credential: { kind: 'session', raw: sessionToken },
    },
    permission,
    accessRevision: '0',
    lifecycle: createConnectionLifecycle(),
  });
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export function createMockLogger(): ReturnType<typeof getLogger> {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof getLogger>;
}

export async function expectAuthenticationFailure(
  port: number,
  token?: string,
  documentName = crypto.randomUUID(),
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const provider = new HocuspocusProvider({
      url: `ws://localhost:${port}`,
      name: documentName,
      document: new Y.Doc(),
      ...(token ? { token } : {}),
      onAuthenticationFailed: () => {
        clearTimeout(timeout);
        provider.destroy();
        resolve();
      },
    });
    const timeout = setTimeout(() => {
      provider.destroy();
      reject(new Error('Timed out waiting for authentication failure'));
    }, 5_000);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createAnonymousHookContext(
  userId: string,
  permission: 'view' | 'edit',
): CollabSession {
  return createCollabSession({
    principal: {
      kind: 'anonymous',
      user: { id: userId, name: getAnonymousName(userId) },
      sessionToken: `anon:${userId}`,
    },
    permission,
    accessRevision: '0',
    lifecycle: createConnectionLifecycle(),
  });
}

export async function waitForExactWorkspaceLockWaiter(
  pool: ReturnType<typeof getTestPool>,
  blockerPid: number,
  label: string,
): Promise<Date> {
  let transactionStartedAt: Date | undefined;
  await waitFor(
    async () => {
      const result = await pool.query<{ xact_start: Date | null }>(
        `select xact_start
         from pg_stat_activity
         where pg_blocking_pids(pid) = array[$1]::integer[]
           and wait_event_type = 'Lock'
           and query like '%pg_advisory_xact_lock%'
         order by xact_start
         limit 1`,
        [blockerPid],
      );
      transactionStartedAt = result.rows[0]?.xact_start ?? undefined;
      return transactionStartedAt !== undefined;
    },
    5_000,
    label,
  );
  if (!transactionStartedAt) throw new Error(`Missing transaction start for ${label}`);
  return transactionStartedAt;
}

export async function waitUntilAfter(
  pool: ReturnType<typeof getTestPool>,
  expiresAt: Date,
): Promise<Date> {
  await pool.query(
    `select pg_sleep(
       greatest(0, extract(epoch from ($1::timestamptz - clock_timestamp())) + 0.1)
     )`,
    [expiresAt],
  );
  const result = await pool.query<{ observed_at: Date }>('select clock_timestamp() as observed_at');
  const observedAt = result.rows[0]?.observed_at;
  if (!observedAt) throw new Error('Missing database clock after expiry wait');
  return observedAt;
}

export function createConnectionConfig(): ConnectionConfiguration {
  return {
    readOnly: false,
    isAuthenticated: false,
  };
}

export function canonicalTestAwarenessUser(userId: string) {
  return {
    name: 'Test User',
    color: getStableColor(userId),
    avatar: null,
  };
}

export function decodeProtocolMessageType(message: Uint8Array): number {
  const documentNameLength = readEncodedVarUint(message, 0);
  return readEncodedVarUint(message, documentNameLength.offset + documentNameLength.value).value;
}

export function readEncodedVarUint(
  input: Uint8Array,
  initialOffset: number,
): { value: number; offset: number } {
  let value = 0;
  let multiplier = 1;
  let offset = initialOffset;
  while (offset < input.length) {
    const byte = input[offset];
    if (byte === undefined) break;
    value += (byte & 0x7f) * multiplier;
    offset += 1;
    if (byte < 0x80) return { value, offset };
    multiplier *= 128;
  }
  throw new Error('Malformed test protocol message');
}

export function encodeYjsUpdateMessage(
  documentName: string,
  update: Uint8Array,
  { messageType = 0, syncType = 2 }: { messageType?: 0 | 4; syncType?: 0 | 1 | 2 } = {},
): Uint8Array {
  const name = new TextEncoder().encode(documentName);
  const chunks = [
    encodeVarUint(name.length),
    name,
    Uint8Array.of(messageType),
    Uint8Array.of(syncType),
    encodeVarUint(update.length),
    update,
  ];
  return concatBytes(chunks);
}

export function appendWikiLink(
  document: Y.Doc,
  { path, label, targetId }: { path: string; label: string; targetId?: string | undefined },
): void {
  const content = document.getText('content');
  const target = targetId ? `id:${targetId}` : path;
  const markdown = `[[${target}${label ? `|${label}` : ''}]]`;
  content.insert(content.length, `${content.length > 0 ? '\n\n' : ''}${markdown}`);
}

export function createAuthenticatePayload(
  server: Server,
  overrides: Partial<onAuthenticatePayload> = {},
): onAuthenticatePayload {
  return {
    context: {},
    documentName: crypto.randomUUID(),
    instance: server.hocuspocus,
    requestHeaders: new Headers(),
    requestParameters: new URLSearchParams(),
    request: new Request('http://localhost'),
    socketId: crypto.randomUUID(),
    token: '',
    connectionConfig: createConnectionConfig(),
    providerVersion: null,
    ...overrides,
  };
}

export type PausedConnectionHarness = {
  connection: Connection;
  context: Record<string, unknown>;
  document: Document;
  hookResolved: Promise<void>;
  admissionsResolved(): number;
  releaseApply(): void;
  teardown: Promise<void>;
};

export function applicationsInFlight(context: Record<string, unknown>): number | undefined {
  const application = (context as CollabSession).lifecycle.application;
  return application.state === 'running' ? application.inFlight : 0;
}

export async function createPausedConnectionHarness(
  server: Server,
  pageId: string,
  sessionToken: string,
): Promise<PausedConnectionHarness> {
  const connectionConfig = createConnectionConfig();
  const context = (await server.hocuspocus.hooks(
    'onAuthenticate',
    createAuthenticatePayload(server, {
      documentName: pageId,
      token: sessionToken,
      connectionConfig,
    }),
  )) as Record<string, unknown>;
  const document = new Document(pageId);
  const socketId = crypto.randomUUID();
  const payloadBase = {
    context,
    document,
    documentName: pageId,
    instance: server.hocuspocus,
    requestHeaders: new Headers(),
    requestParameters: new URLSearchParams(),
    socketId,
  };
  await server.hocuspocus.hooks('onLoadDocument', {
    ...payloadBase,
    connectionConfig,
  });
  server.hocuspocus.documents.set(pageId, document);

  const fakeSocket = {
    binaryType: 'nodebuffer',
    readyState: WebSocket.OPEN,
    send: vi.fn((_message: unknown, callback?: (error?: Error) => void) => callback?.()),
  } as unknown as WebSocket;
  const connection = new Connection(
    fakeSocket,
    new Request('http://localhost'),
    document,
    socketId,
    context,
    connectionConfig.readOnly,
    undefined,
    undefined,
    server.hocuspocus.configuration.lifecycleHooks,
  );
  const pendingChanges: Promise<unknown>[] = [];
  document.onUpdate((hocuspocusDocument, origin, update) => {
    pendingChanges.push(
      server.hocuspocus.hooks('onChange', {
        ...payloadBase,
        clientsCount: hocuspocusDocument.getConnectionsCount(),
        document: hocuspocusDocument,
        transactionOrigin: origin,
        update,
      }),
    );
  });

  let resolveHook: (() => void) | undefined;
  let resolvedAdmissions = 0;
  const hookResolved = new Promise<void>((resolve) => {
    resolveHook = resolve;
  });
  let releaseApply: (() => void) | undefined;
  const applicationRelease = new Promise<void>((resolve) => {
    releaseApply = resolve;
  });
  connection.beforeHandleMessage(async (activeConnection, update) => {
    await server.hocuspocus.hooks('beforeHandleMessage', {
      ...payloadBase,
      clientsCount: document.getConnectionsCount(),
      connection: activeConnection,
      update,
    });
    resolvedAdmissions += 1;
    resolveHook?.();
    await applicationRelease;
  });
  let resolveTeardown: (() => void) | undefined;
  let rejectTeardown: ((error: unknown) => void) | undefined;
  const teardown = new Promise<void>((resolve, reject) => {
    resolveTeardown = resolve;
    rejectTeardown = reject;
  });
  connection.onClose(() => {
    void (async () => {
      let phase = 'pending changes';
      try {
        await Promise.all(pendingChanges);
        phase = 'disconnect persistence';
        await server.hocuspocus.hooks('onDisconnect', {
          ...payloadBase,
          clientsCount: document.getConnectionsCount(),
        } satisfies onDisconnectPayload);
        phase = 'before unload';
        await server.hocuspocus.hooks('beforeUnloadDocument', {
          instance: server.hocuspocus,
          documentName: pageId,
          document,
        });
        phase = 'document removal';
        server.hocuspocus.documents.delete(pageId);
        document.destroy();
        phase = 'after unload';
        await server.hocuspocus.hooks('afterUnloadDocument', {
          instance: server.hocuspocus,
          documentName: pageId,
        });
        resolveTeardown?.();
      } catch (error) {
        rejectTeardown?.(
          new Error(`Paused connection teardown failed during ${phase}`, { cause: error }),
        );
      }
    })();
  });

  await server.hocuspocus.hooks('connected', {
    ...payloadBase,
    connection,
    connectionConfig,
    request: new Request('http://localhost'),
    providerVersion: null,
  });

  return {
    connection,
    context,
    document,
    hookResolved,
    admissionsResolved: () => resolvedAdmissions,
    releaseApply: () => releaseApply?.(),
    teardown,
  };
}
