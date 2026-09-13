import { describe, expect, it, vi } from 'vitest';

vi.mock('@hocuspocus/server', () => ({
  Connection: class {
    context = {};
    document = { hasConnection: () => false };
    close() {}
    send() {}
    sendCurrentAwareness() {}
  },
  MessageReceiver: class {
    apply() {}
  },
  Server: class {
    hocuspocus = { documents: new Map() };
    webSocketServer = { options: {} };
    listen() {}
    destroy() {}
  },
}));

vi.mock('pg', () => ({
  Pool: class {
    query() {
      return Promise.resolve({ rows: [] });
    }
    on() {}
  },
}));

vi.mock('@metakip/shared', async () => {
  const actual = await vi.importActual<typeof import('@metakip/shared')>('@metakip/shared');
  return {
    ...actual,
    setupLogger: vi.fn(),
    getCollabLogger: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
  };
});

vi.mock('@metakip/shared/yjs-helpers', () => ({
  extractConnectionsFromYDoc: vi.fn(() => []),
  normalizeTagSlug: vi.fn((value: string) => `#${value.replace(/^#+/, '').toLowerCase()}`),
}));

describe('collab package entry point', () => {
  it('resolves the module graph without errors', async () => {
    vi.stubEnv('COLLAB_INTERNAL_SECRET', 'test-collaboration-internal-secret');
    vi.stubEnv('DATABASE_URL', 'postgresql://metakip:password@localhost:5432/metakip');
    const mod = await import('./index');
    expect(mod).toBeDefined();
  });
});
