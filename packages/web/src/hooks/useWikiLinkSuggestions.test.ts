import type { EditorView } from '@codemirror/view';
import { renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: null as { user?: { id: string } | null } | null,
  pages: [] as Array<{ id: string; ownerId?: string | null }>,
}));

vi.mock('./useAuth', () => ({
  useAuth: () => ({ data: mocks.session }),
}));
vi.mock('./use-pages', () => ({
  usePages: () => ({ data: mocks.pages }),
  useCreatePage: () => ({ mutateAsync: vi.fn() }),
}));

import { useWikiLinkSuggestions } from './useWikiLinkSuggestions';

const editorRef = { current: null } as RefObject<EditorView | null>;

describe('useWikiLinkSuggestions page creation policy', () => {
  beforeEach(() => {
    mocks.session = null;
    mocks.pages = [];
  });

  it('shows no page suggestions until the source workspace is known', () => {
    mocks.pages = [
      { id: 'other-page-1', ownerId: 'workspace-a' },
      { id: 'other-page-2', ownerId: 'workspace-b' },
    ];

    const { result } = renderHook(() => useWikiLinkSuggestions(editorRef, 'source-page'));

    expect(result.current.allPages).toEqual([]);
  });

  it('does not offer page creation to anonymous link editors', () => {
    mocks.pages = [{ id: 'source-page', ownerId: 'workspace-owner' }];

    const { result } = renderHook(() => useWikiLinkSuggestions(editorRef, 'source-page'));

    expect(result.current.canAddPage).toBe(false);
  });

  it('does not offer page creation in another user workspace', () => {
    mocks.session = { user: { id: 'current-user' } };
    mocks.pages = [{ id: 'source-page', ownerId: 'workspace-owner' }];

    const { result } = renderHook(() => useWikiLinkSuggestions(editorRef, 'source-page'));

    expect(result.current.canAddPage).toBe(false);
  });

  it('offers page creation in the signed-in user workspace', () => {
    mocks.session = { user: { id: 'current-user' } };
    mocks.pages = [{ id: 'source-page', ownerId: 'current-user' }];

    const { result } = renderHook(() => useWikiLinkSuggestions(editorRef, 'source-page'));

    expect(result.current.canAddPage).toBe(true);
  });
});
