import type { Folder, FolderTreeNode, Page, PageTreeNode, User } from '@metakip/shared';

let idCounter = 0;

function nextId(prefix = 'test'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: nextId('user'),
    email: 'test@example.com',
    name: 'Test User',
    avatarUrl: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

export function createMockSession(overrides: { user?: Partial<User> } = {}) {
  const user = createMockUser(overrides.user);
  return {
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.avatarUrl,
      },
      session: {
        id: nextId('session'),
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
      },
    },
    isPending: false,
    error: null,
    refetch: () => Promise.resolve({ data: null, error: null }),
  };
}

export function createMockSessionPending() {
  return {
    data: null,
    isPending: true,
    error: null,
    refetch: () => Promise.resolve({ data: null, error: null }),
  };
}

export function createMockSessionUnauthenticated() {
  return {
    data: { user: null, session: null },
    isPending: false,
    error: null,
    refetch: () => Promise.resolve({ data: null, error: null }),
  };
}

export function createMockPage(overrides: Partial<Page> = {}): Page {
  return {
    id: nextId('page'),
    parentId: null,
    title: 'Untitled',
    icon: null,
    coverType: null,
    coverValue: null,
    position: 'a0',
    properties: null,
    createdBy: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    isDeleted: false,
    deletedAt: null,
    publicPermission: null,
    ...overrides,
  };
}

export function createMockPageTreeNode(overrides: Partial<PageTreeNode> = {}): PageTreeNode {
  return {
    ...createMockPage(overrides),
    children: [],
    ...overrides,
  };
}

export function createMockFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: nextId('folder'),
    parentId: null,
    name: 'New Folder',
    icon: null,
    position: 'a0',
    createdBy: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    isDeleted: false,
    deletedAt: null,
    ...overrides,
  };
}

export function createMockFolderTreeNode(overrides: Partial<FolderTreeNode> = {}): FolderTreeNode {
  return {
    ...createMockFolder(overrides),
    children: [],
    ...overrides,
  };
}

export function createMockTag(overrides: { id?: string; name?: string } = {}) {
  return {
    id: overrides.id ?? nextId('tag'),
    name: overrides.name ?? 'test-tag',
  };
}
