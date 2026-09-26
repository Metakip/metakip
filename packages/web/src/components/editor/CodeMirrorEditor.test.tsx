import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorReadOnlyProvider } from '../../contexts/EditorReadOnlyContext';
import {
  createIdentityLifecycle,
  type IdentityLifecycle,
  IdentityLifecycleProvider,
} from '../../contexts/IdentityLifecycleContext';
import { createTestQueryClient } from '../../test-utils/render';
import { consumeSelfLeave, markSelfLeave, resetSelfLeaveState } from '../../utils/leave-page';

const mocks = vi.hoisted(() => ({
  isAnonymous: true,
  imageUploadFromSlash: null as (() => void) | null,
  editorAction: vi.fn(),
  hasEditor: false,
  initializationStatus: 'ready' as 'initializing' | 'ready' | 'error',
  retryInitialization: vi.fn(),
  showInfoToast: vi.fn(),
  providerHandlers: new Map<string, (payload: unknown) => void>(),
  loggerWarn: vi.fn(),
  setCapabilities: vi.fn(),
  setAccessPermission: vi.fn(),
  currentUserId: 'user-a' as string | null,
  sessionToken: 'token-a',
  getSession: vi.fn(),
  providerToken: null as (() => Promise<string>) | null,
  initialProviderClose: null as { event: CloseEvent } | null,
  initialAuthenticationFailure: null as { reason: string } | null,
  providerConstructions: 0,
}));

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    constructor(configuration: {
      onStateless?: (payload: unknown) => void;
      onClose?: (payload: unknown) => void;
      onAuthenticationFailed?: (payload: unknown) => void;
      token?: () => Promise<string>;
    }) {
      mocks.providerConstructions += 1;
      if (configuration.onStateless) {
        mocks.providerHandlers.set('stateless', configuration.onStateless);
      }
      if (configuration.onClose) {
        mocks.providerHandlers.set('close', configuration.onClose);
        if (mocks.initialProviderClose) configuration.onClose(mocks.initialProviderClose);
      }
      if (configuration.onAuthenticationFailed) {
        mocks.providerHandlers.set('authenticationFailed', configuration.onAuthenticationFailed);
        if (mocks.initialAuthenticationFailure) {
          configuration.onAuthenticationFailed(mocks.initialAuthenticationFailure);
        }
      }
      mocks.providerToken = configuration.token ?? null;
    }
    on = vi.fn((event: string, handler: (payload: unknown) => void) => {
      mocks.providerHandlers.set(event, handler);
    });
    off = vi.fn();
    connect = vi.fn();
    forceSync = vi.fn();
    destroy = vi.fn();
    isAttached = true;
    synced = false;
  }
  return {
    HocuspocusProvider: MockProvider,
    WebSocketStatus: {
      Connecting: 'connecting',
      Connected: 'connected',
      Disconnected: 'disconnected',
    },
  };
});
vi.mock('../../contexts/ShareContext', () => ({
  useShareContext: () => ({ isAnonymous: mocks.isAnonymous }),
  useSetAccessPermission: () => mocks.setAccessPermission,
  useSetCapabilities: () => mocks.setCapabilities,
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    data: mocks.currentUserId ? { user: { id: mocks.currentUserId } } : null,
    isPending: false,
  }),
}));
vi.mock('../../lib/auth-client', () => ({
  authClient: {
    getSession: mocks.getSession,
  },
}));
vi.mock('../../contexts/KeyboardShortcutContext', () => ({
  useShortcut: vi.fn(),
  useShortcuts: vi.fn(),
}));
vi.mock('../../hooks/useAwareness', () => ({ useAwareness: vi.fn() }));
vi.mock('../../hooks/useFloatingToolbar', () => ({
  useFloatingToolbar: () => ({
    visible: false,
    position: null,
    linkEditorOpen: false,
    linkEditorPosition: null,
    linkEditorInitialUrl: '',
    mathEditorOpen: false,
    mathEditorPosition: null,
    mathEditorInitialLatex: '',
    mathEditorDisplayMode: false,
    closeLinkEditor: vi.fn(),
    closeMathEditor: vi.fn(),
    keepVisible: vi.fn(),
  }),
}));
vi.mock('../../hooks/useCodeMirror', () => {
  const editor = {
    dom: document.createElement('div'),
    hasFocus: true,
    focus: vi.fn(),
    dispatch: mocks.editorAction,
    state: {
      readOnly: false,
      selection: { main: { from: 0, to: 0, head: 0, empty: true } },
      doc: { lineAt: () => ({ from: 0, to: 0, text: '' }), length: 0 },
      sliceDoc: () => '',
    },
  };
  return {
    useCodeMirror: (props: { onImageUpload?: (file: File) => Promise<unknown> }) => ({
      setContainer: vi.fn(),
      editor: mocks.hasEditor ? editor : null,
      initializationState:
        mocks.initializationStatus === 'error'
          ? { status: 'error', error: new Error('initialization failed') }
          : { status: mocks.initializationStatus },
      retryInitialization: mocks.retryInitialization,
      uploadImage: (file: File) => {
        const pendingUpload = props.onImageUpload?.(file);
        if (pendingUpload) void pendingUpload.catch(() => undefined);
      },
      refreshHeadingResolver: vi.fn(),
    }),
  };
});
vi.mock('../../hooks/useSlashMenu', () => ({
  useSlashMenu: (
    _editorRef: unknown,
    options: { commands: { command: (id: string) => { execute: () => void } } },
  ) => {
    mocks.imageUploadFromSlash = options.commands.command('image').execute;
    return {
      slashMenuState: { isOpen: false, query: '', position: null, range: null },
      slashCommands: [],
      handleSlashMenuSuggest: vi.fn(),
      closeSlashMenu: vi.fn(),
    };
  },
}));
vi.mock('../../hooks/useWikiLinkSuggestions', () => ({
  useWikiLinkSuggestions: () => ({
    suggestions: { isOpen: false, query: '', position: null, isLoading: false },
    allPages: [],
    handleWikiLinkSuggest: vi.fn(),
    handleWikiLinkSelect: vi.fn(),
    handleAddPage: vi.fn(),
    canAddPage: false,
    closeSuggestions: vi.fn(),
  }),
}));
vi.mock('../../logger-init', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: mocks.loggerWarn,
    error: vi.fn(),
  }),
}));
vi.mock('../../utils/toast', () => ({
  showInfoToast: mocks.showInfoToast,
}));
vi.mock('./FloatingToolbar', () => ({
  FloatingToolbar: () => null,
}));
vi.mock('./SlashMenu', () => ({ SlashMenu: () => null }));
vi.mock('./WikiLinkSuggestions', () => ({ WikiLinkSuggestions: () => null }));

import { CodeMirrorEditor } from './CodeMirrorEditor';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-path">{location.pathname}</output>;
}

function renderEditor({
  readOnly = true,
  lifecycle = createIdentityLifecycle(),
  strictMode = false,
  onDocumentReloadRequired,
}: {
  readOnly?: boolean;
  lifecycle?: IdentityLifecycle;
  strictMode?: boolean;
  onDocumentReloadRequired?: () => void;
} = {}) {
  const queryClient = createTestQueryClient();
  const editor = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pages/page-1']}>
        <LocationProbe />
        <IdentityLifecycleProvider lifecycle={lifecycle}>
          <EditorReadOnlyProvider readOnly={readOnly}>
            <CodeMirrorEditor
              pageId="page-1"
              {...(onDocumentReloadRequired ? { onDocumentReloadRequired } : {})}
            />
          </EditorReadOnlyProvider>
        </IdentityLifecycleProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return {
    queryClient,
    lifecycle,
    ...render(strictMode ? <StrictMode>{editor}</StrictMode> : editor),
  };
}

describe('CodeMirrorEditor anonymous uploads', () => {
  beforeEach(() => {
    mocks.isAnonymous = true;
    mocks.imageUploadFromSlash = null;
    mocks.editorAction.mockReset();
    mocks.hasEditor = false;
    mocks.initializationStatus = 'ready';
    mocks.retryInitialization.mockReset();
    mocks.showInfoToast.mockReset();
    mocks.providerHandlers.clear();
    mocks.loggerWarn.mockReset();
    mocks.setCapabilities.mockReset();
    mocks.setAccessPermission.mockReset();
    mocks.currentUserId = 'user-a';
    mocks.sessionToken = 'token-a';
    mocks.providerToken = null;
    mocks.initialProviderClose = null;
    mocks.initialAuthenticationFailure = null;
    mocks.providerConstructions = 0;
    mocks.getSession.mockReset();
    mocks.getSession.mockImplementation(async () => ({
      data: mocks.currentUserId
        ? { user: { id: mocks.currentUserId }, session: { token: mocks.sessionToken } }
        : null,
    }));
    resetSelfLeaveState();
  });

  it('constructs one collaboration provider for a Yjs document under Strict Mode', () => {
    renderEditor({ strictMode: true });

    expect(mocks.providerConstructions).toBe(1);
  });

  it('keeps the editor content hidden until the initial document sync completes', async () => {
    mocks.hasEditor = true;
    renderEditor();

    expect(document.querySelector('.codemirror-editor')).toHaveClass('invisible');
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();

    act(() => {
      mocks.providerHandlers.get('synced')?.({ state: true });
    });

    await waitFor(() => {
      expect(document.querySelector('.codemirror-editor')).not.toHaveClass('invisible');
    });
    expect(screen.queryByRole('status', { name: 'Loading page' })).not.toBeInTheDocument();
  });

  it('shows a retry state when editor initialization fails before an editor exists', () => {
    mocks.initializationStatus = 'error';
    renderEditor();

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the page content.");
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(mocks.retryInitialization).toHaveBeenCalledOnce();
  });

  it('shows an explicit retry state when the initial document sync times out', async () => {
    mocks.hasEditor = true;
    vi.useFakeTimers();
    try {
      renderEditor();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the page content.");
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      expect(document.querySelector('.codemirror-editor')).toHaveClass('invisible');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not open the image picker for anonymous public editors', () => {
    renderEditor();
    const fileInput = document.createElement('input');
    const inputClickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => undefined);
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(fileInput);

    expect(mocks.imageUploadFromSlash).not.toBeNull();
    act(() => {
      mocks.imageUploadFromSlash?.();
    });

    expect(createElementSpy).not.toHaveBeenCalled();
    expect(inputClickSpy).not.toHaveBeenCalled();
  });

  it('does not start an upload when a retired identity file picker fires late', () => {
    mocks.isAnonymous = false;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { lifecycle } = renderEditor({ readOnly: false });
    const fileInput = document.createElement('input');
    const inputClickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => undefined);
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(fileInput);

    act(() => mocks.imageUploadFromSlash?.());
    expect(inputClickSpy).toHaveBeenCalledTimes(1);

    lifecycle.retire();
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['private image'], 'private.png', { type: 'image/png' })],
    });
    act(() => fileInput.dispatchEvent(new Event('change')));

    expect(fetchSpy).not.toHaveBeenCalled();
    createElementSpy.mockRestore();
    inputClickSpy.mockRestore();
  });

  it('reports malformed collaboration control messages', () => {
    renderEditor();

    expect(() => {
      act(() => mocks.providerHandlers.get('stateless')?.({ payload: 'not-json' }));
    }).not.toThrow();
    expect(mocks.loggerWarn).toHaveBeenCalled();
  });

  it.each([
    { code: 1000, reason: 'Page deleted', toast: 'Page deleted' },
    { code: 1000, reason: 'Access revoked', toast: 'Removed from your view' },
    { code: 1000, reason: 'Session expired', toast: 'Removed from your view' },
    { code: 4402, reason: '', toast: 'Page deleted' },
    { code: 4401, reason: '', toast: 'Removed from your view' },
  ])('evicts cached page content on terminal code=$code reason=$reason closes', ({
    code,
    reason,
    toast,
  }) => {
    const { getByTestId, queryClient } = renderEditor();
    const pageQueryKey = ['pages', 'detail', 'page-1'];
    queryClient.setQueryData(pageQueryKey, { title: 'Stale private title' });

    act(() => {
      mocks.providerHandlers.get('close')?.({
        event: new CloseEvent('close', { code, reason }),
      });
    });

    expect(getByTestId('location-path')).toHaveTextContent('/');
    expect(queryClient.getQueryData(pageQueryKey)).toBeUndefined();
    expect(mocks.setAccessPermission).toHaveBeenLastCalledWith(null);
    expect(mocks.showInfoToast).toHaveBeenCalledWith(toast);
  });

  it.each([
    { code: 1000, reason: '' },
    { code: 1000, reason: 'forced' },
    { code: 1000, reason: 'Page Deleted' },
    { code: 1000, reason: 'Access revoked ' },
    { code: 1006, reason: 'network failure' },
    { code: 4403, reason: 'Write permission required' },
  ])('keeps cached content on non-terminal close code=$code reason=$reason', ({ code, reason }) => {
    const { container, getByTestId, queryClient } = renderEditor();
    const wrapper = container.querySelector('.editor-wrapper');
    const pageQueryKey = ['pages', 'detail', 'page-1'];
    const cachedPage = { title: 'Still authorized' };

    act(() => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({
          type: 'permission_snapshot',
          permission: 'edit',
          accessRevision: '10',
        }),
      });
    });
    expect(wrapper).toHaveClass('editor-scroll-past-end');
    queryClient.setQueryData(pageQueryKey, cachedPage);

    act(() => {
      mocks.providerHandlers.get('close')?.({
        event: new CloseEvent('close', { code, reason }),
      });
    });

    expect(wrapper).not.toHaveClass('editor-scroll-past-end');
    expect(getByTestId('location-path')).toHaveTextContent('/pages/page-1');
    expect(queryClient.getQueryData(pageQueryKey)).toEqual(cachedPage);
    expect(mocks.setAccessPermission).not.toHaveBeenCalledWith(null);
    expect(mocks.showInfoToast).not.toHaveBeenCalled();
  });

  it('requests a fresh provider after a server-directed document reload', () => {
    const onDocumentReloadRequired = vi.fn();
    renderEditor({ onDocumentReloadRequired });

    act(() => {
      mocks.providerHandlers.get('close')?.({
        event: new CloseEvent('close', { code: 1000, reason: 'Document content was replaced' }),
      });
    });

    expect(onDocumentReloadRequired).toHaveBeenCalledOnce();
  });

  it('handles a terminal close that arrives before effect subscriptions are ready', () => {
    mocks.initialProviderClose = {
      event: new CloseEvent('close', { code: 1000, reason: 'Page deleted' }),
    };

    const { getByTestId } = renderEditor();

    expect(getByTestId('location-path')).toHaveTextContent('/');
    expect(mocks.showInfoToast).toHaveBeenCalledWith('Page deleted');
  });

  it('handles a non-terminal logical close before effect subscriptions are ready', () => {
    mocks.initialProviderClose = {
      event: new CloseEvent('close', { code: 1000, reason: 'Write permission required' }),
    };

    const { container, getByTestId } = renderEditor();

    expect(container.querySelector('.editor-wrapper')).not.toHaveClass('editor-scroll-past-end');
    expect(getByTestId('location-path')).toHaveTextContent('/pages/page-1');
    // One fail-closed application comes from initial setup and one proves the
    // constructor-time close was queued until its effect handler was ready.
    expect(mocks.setCapabilities).toHaveBeenCalledTimes(2);
    expect(mocks.showInfoToast).not.toHaveBeenCalled();
  });

  it('evicts an already-rendered page when document authentication fails', () => {
    const { container, getByTestId, queryClient } = renderEditor();
    const wrapper = container.querySelector('.editor-wrapper');
    const pageQueryKey = ['pages', 'detail', 'page-1'];
    queryClient.setQueryData(pageQueryKey, { title: 'Stale private title' });

    act(() => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({
          type: 'permission_snapshot',
          permission: 'edit',
          accessRevision: '10',
        }),
      });
    });
    expect(wrapper).toHaveClass('editor-scroll-past-end');

    act(() => {
      mocks.providerHandlers.get('authenticationFailed')?.({ reason: 'Unauthorized' });
    });

    expect(wrapper).not.toHaveClass('editor-scroll-past-end');
    expect(getByTestId('location-path')).toHaveTextContent('/');
    expect(queryClient.getQueryData(pageQueryKey)).toBeUndefined();
    expect(mocks.setAccessPermission).toHaveBeenLastCalledWith(null);
    expect(mocks.showInfoToast).toHaveBeenCalledWith('Removed from your view');
  });

  it('handles authentication failure before effect subscriptions are ready', () => {
    mocks.initialAuthenticationFailure = { reason: 'Unauthorized' };

    const { getByTestId } = renderEditor();

    expect(getByTestId('location-path')).toHaveTextContent('/');
    expect(mocks.showInfoToast).toHaveBeenCalledWith('Removed from your view');
  });

  it('deduplicates the stateless deletion hint and terminal close', () => {
    renderEditor();

    act(() => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({
          type: 'entity_deleted',
          entityType: 'page',
          entityId: 'page-1',
        }),
      });
      mocks.providerHandlers.get('close')?.({
        event: new CloseEvent('close', { code: 1000, reason: 'Page deleted' }),
      });
    });

    expect(mocks.showInfoToast).toHaveBeenCalledTimes(1);
    expect(mocks.showInfoToast).toHaveBeenCalledWith('Page deleted');
  });

  it('deduplicates authentication failure, terminal close, and stateless eviction', () => {
    renderEditor();

    act(() => {
      mocks.providerHandlers.get('authenticationFailed')?.({ reason: 'Unauthorized' });
      mocks.providerHandlers.get('close')?.({
        event: new CloseEvent('close', { code: 1000, reason: 'Access revoked' }),
      });
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({
          type: 'entity_deleted',
          entityType: 'page',
          entityId: 'page-1',
        }),
      });
    });

    expect(mocks.showInfoToast).toHaveBeenCalledTimes(1);
    expect(mocks.showInfoToast).toHaveBeenCalledWith('Removed from your view');
  });

  it('drops delayed collaboration events after the identity retires', () => {
    const { lifecycle, queryClient } = renderEditor();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const delayedStatelessHandler = mocks.providerHandlers.get('stateless');
    if (!delayedStatelessHandler) throw new Error('Expected a stateless handler');

    lifecycle.retire();
    act(() => {
      delayedStatelessHandler({
        payload: JSON.stringify({
          type: 'grant_received',
          sharedByName: 'Private account A sharer',
          entityTitle: 'Private account A title',
        }),
      });
    });

    expect(mocks.showInfoToast).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('shows a verified grant notification and refreshes recipient access', () => {
    const { queryClient } = renderEditor();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mocks.showInfoToast.mockClear();

    act(() => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({
          type: 'grant_received',
          sharedByName: 'Owner',
          entityTitle: 'Shared page',
          message: 'Actor-only copy must not be shown to the recipient',
        }),
      });
    });

    expect(invalidateSpy).toHaveBeenCalled();
    expect(mocks.showInfoToast).toHaveBeenCalledWith('Owner shared Shared page with you');
  });

  it('drops delayed authentication failures after the identity retires', () => {
    const { getByTestId, lifecycle, queryClient } = renderEditor();
    const pageQueryKey = ['pages', 'detail', 'page-1'];
    const cachedPage = { title: 'Current identity only' };
    queryClient.setQueryData(pageQueryKey, cachedPage);
    const delayedAuthenticationFailed = mocks.providerHandlers.get('authenticationFailed');
    if (!delayedAuthenticationFailed) {
      throw new Error('Expected an authentication failure handler');
    }

    lifecycle.retire();
    act(() => delayedAuthenticationFailed({ reason: 'Unauthorized' }));

    expect(getByTestId('location-path')).toHaveTextContent('/pages/page-1');
    expect(queryClient.getQueryData(pageQueryKey)).toEqual(cachedPage);
    expect(mocks.showInfoToast).not.toHaveBeenCalled();
  });

  it('stays fail-closed until an authoritative permission snapshot arrives', () => {
    const { container } = renderEditor();
    const wrapper = container.querySelector('.editor-wrapper');

    expect(wrapper).not.toHaveClass('editor-scroll-past-end');

    act(() => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({
          type: 'permission_snapshot',
          permission: 'edit',
          accessRevision: '10',
        }),
      });
    });

    expect(wrapper).toHaveClass('editor-scroll-past-end');
  });

  it('ignores stale snapshots and non-authoritative share events', () => {
    const { container } = renderEditor();
    const wrapper = container.querySelector('.editor-wrapper');
    const send = (permission: 'view' | 'edit', accessRevision: string) => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({ type: 'permission_snapshot', permission, accessRevision }),
      });
    };

    act(() => send('edit', '10'));
    expect(wrapper).toHaveClass('editor-scroll-past-end');

    act(() => send('view', '9'));
    expect(wrapper).toHaveClass('editor-scroll-past-end');

    act(() => send('view', '11'));
    expect(wrapper).not.toHaveClass('editor-scroll-past-end');

    act(() => send('edit', '11'));
    expect(wrapper).not.toHaveClass('editor-scroll-past-end');

    act(() => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({ type: 'share_event', action: 'update', permission: 'edit' }),
      });
    });
    expect(wrapper).not.toHaveClass('editor-scroll-past-end');
  });

  it('applies an equal-revision downgrade from canonical revalidation', () => {
    const { container, queryClient } = renderEditor();
    const wrapper = container.querySelector('.editor-wrapper');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const send = (permission: 'view' | 'edit', accessRevision: string) => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({ type: 'permission_snapshot', permission, accessRevision }),
      });
    };

    act(() => send('edit', '20'));
    expect(wrapper).toHaveClass('editor-scroll-past-end');
    invalidateSpy.mockClear();
    act(() => send('view', '20'));
    expect(wrapper).not.toHaveClass('editor-scroll-past-end');
    for (const queryKey of [
      ['pageTree'],
      ['folderTree'],
      ['pages', 'recent'],
      ['shares'],
      ['pages', 'detail'],
      ['folders', 'detail'],
    ]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('invalidates every access-sensitive cache after any newer non-null snapshot', () => {
    const { queryClient } = renderEditor();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const send = (permission: 'view' | 'edit', accessRevision: string) => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({ type: 'permission_snapshot', permission, accessRevision }),
      });
    };

    act(() => send('edit', '10'));
    invalidateSpy.mockClear();
    // The effective permission can stay the same when a direct grant is
    // replaced by a folder fallback. The newer revision must still refresh
    // provenance and every navigation surface.
    act(() => send('edit', '11'));

    for (const queryKey of [
      ['pageTree'],
      ['folderTree'],
      ['pages', 'recent'],
      ['shares'],
      ['pageCollaborators'],
      ['folderCollaborators'],
      ['pages', 'detail'],
      ['folders', 'detail'],
    ]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('clears a self-leave marker on a fallback snapshot before a later revoke', () => {
    renderEditor();
    const send = (permission: 'edit' | null, accessRevision: string) => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({ type: 'permission_snapshot', permission, accessRevision }),
      });
    };

    act(() => send('edit', '10'));
    markSelfLeave('page-1');
    act(() => send('edit', '11'));

    expect(consumeSelfLeave('page-1')).toBe(false);
    mocks.showInfoToast.mockClear();
    act(() => send(null, '12'));
    expect(mocks.showInfoToast).toHaveBeenCalledWith('Removed from your view');
  });

  it('suppresses only the revoke snapshot caused by the pending self-leave', () => {
    const { getByTestId, queryClient } = renderEditor();
    queryClient.setQueryData(['pages', 'detail', 'page-1'], {
      id: 'page-1',
      parentId: 'folder-1',
    });
    const send = (permission: 'edit' | null, accessRevision: string) => {
      mocks.providerHandlers.get('stateless')?.({
        payload: JSON.stringify({ type: 'permission_snapshot', permission, accessRevision }),
      });
    };

    act(() => send('edit', '10'));
    markSelfLeave('page-1');
    mocks.showInfoToast.mockClear();
    act(() => send(null, '11'));

    expect(mocks.showInfoToast).not.toHaveBeenCalledWith('Removed from your view');
    expect(consumeSelfLeave('page-1')).toBe(false);
    expect(getByTestId('location-path')).toHaveTextContent('/folder/folder-folder-1');
  });

  it('scopes cached collaboration tokens to the current non-empty identity', async () => {
    mocks.isAnonymous = false;
    const rendered = renderEditor();
    const getProviderToken = () => {
      if (!mocks.providerToken) throw new Error('Expected provider token callback');
      return mocks.providerToken();
    };

    expect(await getProviderToken()).toBe('token-a');
    expect(await getProviderToken()).toBe('token-a');
    expect(mocks.getSession).toHaveBeenCalledTimes(1);

    mocks.currentUserId = 'user-b';
    mocks.sessionToken = 'token-b';
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <MemoryRouter>
          <EditorReadOnlyProvider readOnly={true}>
            <CodeMirrorEditor pageId="page-1" />
          </EditorReadOnlyProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await getProviderToken()).toBe('token-b');
    expect(mocks.getSession).toHaveBeenCalledTimes(2);

    mocks.sessionToken = '';
    mocks.currentUserId = 'user-c';
    rendered.rerender(
      <QueryClientProvider client={rendered.queryClient}>
        <MemoryRouter>
          <EditorReadOnlyProvider readOnly={true}>
            <CodeMirrorEditor pageId="page-1" />
          </EditorReadOnlyProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await expect(getProviderToken()).rejects.toThrow('session changed or is unavailable');
    mocks.sessionToken = 'token-c';
    expect(await getProviderToken()).toBe('token-c');
    expect(mocks.getSession).toHaveBeenCalledTimes(4);
  });

  it('rejects a cached collaboration token after the identity retires', async () => {
    mocks.isAnonymous = false;
    const { lifecycle } = renderEditor();
    const getProviderToken = () => {
      if (!mocks.providerToken) throw new Error('Expected provider token callback');
      return mocks.providerToken();
    };

    expect(await getProviderToken()).toBe('token-a');
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    lifecycle.retire();

    await expect(getProviderToken()).rejects.toThrow('identity is no longer active');
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });
});
