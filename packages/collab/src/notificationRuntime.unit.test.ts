import { EventEmitter } from 'node:events';
import type { Logger } from '@logtape/logtape';
import type { Client, Pool, QueryResult } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNotificationRuntime } from './notificationRuntime';

class FakeListenClient extends EventEmitter {
  readonly connect = vi.fn(async (): Promise<void> => undefined);
  readonly query = vi.fn(async () => ({ rows: [] }) as unknown as QueryResult);
  readonly end = vi.fn(async (): Promise<void> => undefined);
}

function createRuntimeOptions(createListenClient: (databaseUrl: string) => Client) {
  return {
    server: { hocuspocus: { documents: new Map() } } as never,
    pool: { query: vi.fn() } as unknown as Pool,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger,
    databaseUrl: 'postgres://database.test/metakip',
    permissionRevalidationMs: 0,
    publications: {
      grantReceived: vi.fn(async () => undefined),
      pageContentReplaced: vi.fn(async () => undefined),
      pageRenamed: vi.fn(async () => undefined),
      pageDeleted: vi.fn(async () => undefined),
      folderDeleted: vi.fn(async () => undefined),
      rebuildMetadata: vi.fn(async () => undefined),
      reconcileAll: vi.fn(async () => undefined),
      reconcileContent: vi.fn(async () => undefined),
      reconcileDeletions: vi.fn(async () => undefined),
    },
    createListenClient,
  };
}

async function flushConnectionSetup(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('notification runtime connection lifecycle', () => {
  it('schedules one reconnect when pg emits both error and end', async () => {
    vi.useFakeTimers();
    const clients: FakeListenClient[] = [];
    const createListenClient = vi.fn(() => {
      const client = new FakeListenClient();
      clients.push(client);
      return client as unknown as Client;
    });
    const options = createRuntimeOptions(createListenClient);
    const dispose = installNotificationRuntime(options);
    await flushConnectionSetup();

    expect(createListenClient).toHaveBeenCalledTimes(1);
    clients[0]?.emit('error', new Error('connection lost'));
    clients[0]?.emit('end');

    await vi.advanceTimersByTimeAsync(999);
    expect(createListenClient).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await flushConnectionSetup();
    expect(createListenClient).toHaveBeenCalledTimes(2);
    expect(options.publications.reconcileContent).toHaveBeenCalledTimes(2);

    await dispose();
  });

  it('does not reload pages on the initial notification subscription', async () => {
    const client = new FakeListenClient();
    const options = createRuntimeOptions(() => client as unknown as Client);
    const dispose = installNotificationRuntime(options);
    await flushConnectionSetup();

    expect(options.publications.reconcileAll).toHaveBeenCalledOnce();
    expect(options.publications.reconcileContent).toHaveBeenCalledOnce();

    await dispose();
  });

  it('closes and awaits a client whose connection is still pending', async () => {
    let rejectConnect: ((error: Error) => void) | undefined;
    const client = new FakeListenClient();
    client.connect.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectConnect = reject;
        }),
    );
    client.end.mockImplementation(async () => {
      rejectConnect?.(new Error('connection closed'));
    });
    const dispose = installNotificationRuntime(
      createRuntimeOptions(() => client as unknown as Client),
    );
    await Promise.resolve();

    await dispose();

    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
