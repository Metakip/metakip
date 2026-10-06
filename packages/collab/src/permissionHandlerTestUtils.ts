import type { Server } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import type { Pool } from 'pg';
import { type Mock, vi } from 'vitest';
import { type CollabSession, createCollabSession } from './collabSession';
import { createConnectionLifecycle } from './connectionLifecycle';

export function createLogger() {
  const fn = () => vi.fn();
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    category: fn(),
    parent: null,
    getChild: fn(),
    with: fn(),
    get enabled() {
      return true;
    },
    log: fn(),
    trace: fn(),
  } as unknown as Logger;
}

export type TestConnection = {
  context: CollabSession;
  readOnly: boolean;
  sendStateless: Mock;
  close: Mock;
};

export function createConnection(overrides?: {
  context?: {
    user?: { id: string; isAnonymous?: boolean };
    permission?: string;
    accessRevision?: string;
    sessionToken?: string;
  };
  readOnly?: boolean;
}): TestConnection {
  const input = overrides?.context ?? { user: { id: 'user-1' }, permission: 'edit' };
  if (overrides?.context && !overrides.context.user) {
    return {
      context: overrides.context as unknown as CollabSession,
      readOnly: overrides.readOnly ?? false,
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
  }
  const user = input.user ?? { id: 'user-1' };
  const permission =
    input.permission === 'view' ||
    input.permission === 'commenter' ||
    input.permission === 'edit' ||
    input.permission === 'admin'
      ? input.permission
      : null;
  const context: CollabSession = createCollabSession(
    user.isAnonymous === true
      ? {
          principal: {
            kind: 'anonymous',
            user: { id: user.id, name: 'Anonymous' },
            sessionToken: `anon:${user.id}`,
          },
          permission,
          accessRevision: input.accessRevision ?? '1',
          lifecycle: createConnectionLifecycle(),
        }
      : {
          principal: {
            kind: 'account',
            user: {
              id: user.id,
              email: `${user.id}@example.com`,
              name: user.id,
              avatarUrl: null,
            },
            credential: { kind: 'session', raw: input.sessionToken ?? `session:${user.id}` },
          },
          permission,
          accessRevision: input.accessRevision ?? '1',
          lifecycle: createConnectionLifecycle(),
        },
  );
  return {
    context,
    readOnly: overrides?.readOnly ?? false,
    sendStateless: vi.fn(),
    close: vi.fn(),
  };
}

export type TestDocument = {
  getConnections: () => TestConnection[];
  transact: (callback: () => void) => void;
  getMap: (name?: string) => {
    get: (key: string) => number | undefined;
    set: (key: string, value: number) => void;
  };
};

export function createDocument(connections: TestConnection[]): TestDocument {
  const accessVersions = new Map<string, number>();
  return {
    getConnections: () => connections,
    transact: (callback: () => void) => callback(),
    getMap: (_name?: string) => ({
      get: (key: string) => accessVersions.get(key),
      set: (key: string, value: number) => accessVersions.set(key, value),
    }),
  };
}

export function createServer(doc: TestDocument | undefined) {
  return {
    hocuspocus: { documents: { get: vi.fn().mockReturnValue(doc) } },
    configure: vi.fn(),
    destroy: vi.fn(),
    listen: vi.fn(),
  } as unknown as Server;
}

export function createServerWithDocuments(documents: Map<string, TestDocument>): Server {
  return {
    hocuspocus: { documents },
    configure: vi.fn(),
    destroy: vi.fn(),
    listen: vi.fn(),
  } as unknown as Server;
}

export function createPool(
  entries: Array<{ user_id: string; permission: string }> = [],
  options?: { anonymousPermission?: string | null; defaultPermission?: string | null },
) {
  return {
    query: vi.fn(async (queryText: string, params?: unknown[]) => {
      if (queryText.includes('get_page_base_permissions')) return { rows: entries };
      if (queryText.includes('get_effective_page_permission')) {
        const requestedPages = params?.[0];
        const requestedUsers = params?.[1];
        if (Array.isArray(requestedPages) && Array.isArray(requestedUsers)) {
          return {
            rows: requestedUsers.map((userId, index) => {
              const entry = entries.find((item) => item.user_id === userId);
              return {
                page_id: requestedPages[index],
                user_id: userId,
                permission: entry?.permission ?? options?.defaultPermission ?? null,
                access_revision: '100',
              };
            }),
          };
        }
        const entry = entries.find((item) => item.user_id === requestedUsers);
        return {
          rows: [
            {
              permission: entry?.permission ?? options?.defaultPermission ?? null,
              access_revision: '100',
            },
          ],
        };
      }
      if (queryText.includes('get_public_page_permission')) {
        const requestedPages = params?.[0];
        return {
          rows: Array.isArray(requestedPages)
            ? requestedPages.map((pageId) => ({
                page_id: pageId,
                permission: options?.anonymousPermission ?? null,
                access_revision: '100',
              }))
            : [{ permission: options?.anonymousPermission ?? null, access_revision: '100' }],
        };
      }
      return { rows: entries };
    }),
  } as unknown as Pool;
}

export const ACTIVE_PAGE_ID = '00000000-0000-4000-8000-000000000001';
export const OTHER_ACTIVE_PAGE_ID = '00000000-0000-4000-8000-000000000002';

export function permissionEntry(userId: string, permission: string = 'view') {
  return { user_id: userId, permission };
}
