import type { EditorView } from '@codemirror/view';
import { HocuspocusProvider, type WebSocketStatus } from '@hocuspocus/provider';
import type { SharePermission } from '@metakip/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { useSetReadOnly } from '../contexts/EditorReadOnlyContext';
import { useIdentityLifecycle, useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { useSetAccessPermission, useSetCapabilities } from '../contexts/ShareContext';
import { getLogger } from '../logger-init';
import { CollaborationEventBridge } from '../utils/collaborationEventBridge';
import { CollaborationLifecycleController } from '../utils/collaborationLifecycleController';
import { getOrCreatePageProvider } from '../utils/collaborationProviderCache';
import { CollaborationTokenRuntime } from '../utils/collaborationTokenRuntime';
import { getCollaborationUrl } from '../utils/collaborationUrl';
import { invalidateWorkspaceAccessQueries } from './use-workspace';
import { useAwareness } from './useAwareness';

const COLLAB_URL = getCollaborationUrl();

type MutableValue<T> = { current: T };

type PageCollaborationOptions = {
  pageId: string;
  editorRef: MutableValue<EditorView | null>;
  isAnonymous: boolean;
  currentUserId: string | null;
  onStatusChange?: (status: WebSocketStatus) => void;
  onDocumentReloadRequired?: () => void;
  onPermissionSnapshot?: (permission: SharePermission | null, accessRevision: string) => void;
};

type LatestLifecycleOptions = Pick<
  PageCollaborationOptions,
  'isAnonymous' | 'onDocumentReloadRequired' | 'onPermissionSnapshot' | 'onStatusChange'
>;

function useProviderLifecycle(
  provider: HocuspocusProvider,
  doc: Y.Doc,
  eventBridge: CollaborationEventBridge,
  options: PageCollaborationOptions,
): void {
  const identityLifecycle = useIdentityLifecycle();
  const navigate = useIdentityNavigate();
  const queryClient = useQueryClient();
  const setReadOnly = useSetReadOnly();
  const setAccessPermission = useSetAccessPermission();
  const setCapabilities = useSetCapabilities();
  const setAccessPermissionRef = useRef(setAccessPermission);
  const setCapabilitiesRef = useRef(setCapabilities);
  setAccessPermissionRef.current = setAccessPermission;
  setCapabilitiesRef.current = setCapabilities;
  const latestOptionsRef = useRef<LatestLifecycleOptions>(options);
  latestOptionsRef.current = options;

  // One controller owns one provider/page generation. Dynamic callback props
  // are read through latestOptionsRef and do not rebuild the generation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: provider/pageId define the lifecycle generation
  useEffect(() => {
    const controller = new CollaborationLifecycleController({
      provider,
      doc,
      pageId: options.pageId,
      editorRef: options.editorRef,
      eventBridge,
      isIdentityActive: identityLifecycle.isActive,
      getLatestOptions: () => latestOptionsRef.current,
      logger: getLogger(),
      navigate,
      queryClient,
      setReadOnly,
      setAccessPermission: (permission) => setAccessPermissionRef.current(permission),
      setCapabilities: (capabilities) => setCapabilitiesRef.current(capabilities),
      invalidateWorkspaceAccess: () => invalidateWorkspaceAccessQueries(queryClient),
    });
    return controller.attach();
  }, [provider, options.pageId]);
}

function useProviderDisposal(provider: HocuspocusProvider, doc: Y.Doc): void {
  const isMountedRef = useRef(true);
  const latestProviderRef = useRef(provider);
  const latestDocRef = useRef(doc);
  latestProviderRef.current = provider;
  latestDocRef.current = doc;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const capturedProvider = provider;
    const capturedDoc = doc;
    return () => {
      if (latestProviderRef.current !== capturedProvider || latestDocRef.current !== capturedDoc) {
        // Let the editor's effect cleanup run before destroying the Yjs
        // document. Otherwise y-codemirror can observe a destroyed document
        // while the editor is being replaced during page navigation.
        window.setTimeout(() => {
          capturedProvider.forceSync();
          capturedProvider.destroy();
          capturedDoc.destroy();
        }, 0);
        return;
      }
      setTimeout(() => {
        if (!isMountedRef.current) {
          capturedProvider.forceSync();
          capturedProvider.destroy();
          capturedDoc.destroy();
        }
      }, 0);
    };
  }, [doc, provider]);
}

export function usePageCollaboration(options: PageCollaborationOptions): {
  doc: Y.Doc;
  provider: HocuspocusProvider;
} {
  const identityLifecycle = useIdentityLifecycle();
  // A page generation owns its document and provider as one disposable unit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pageId defines the document generation
  const doc = useMemo(() => new Y.Doc(), [options.pageId]);
  // One bridge belongs to one page/provider generation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pageId defines the provider generation
  const eventBridge = useMemo(
    () => new CollaborationEventBridge(identityLifecycle.isActive),
    [identityLifecycle, options.pageId],
  );
  // Identity changes update this runtime below without replacing the provider;
  // page navigation creates a fresh generation and clears its token cache.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pageId defines the provider generation
  const tokenRuntime = useMemo(
    () =>
      new CollaborationTokenRuntime(
        { isAnonymous: options.isAnonymous, currentUserId: options.currentUserId },
        identityLifecycle.isActive,
      ),
    [identityLifecycle, options.pageId],
  );
  tokenRuntime.updateIdentity({
    isAnonymous: options.isAnonymous,
    currentUserId: options.currentUserId,
  });

  const provider = useMemo(
    () =>
      getOrCreatePageProvider(
        doc,
        options.pageId,
        identityLifecycle,
        () =>
          new HocuspocusProvider({
            url: COLLAB_URL,
            name: options.pageId,
            document: doc,
            forceSyncInterval: 2000,
            onStateless: eventBridge.onStateless,
            onClose: eventBridge.onClose,
            onAuthenticationFailed: eventBridge.onAuthenticationFailed,
            token: tokenRuntime.getToken,
          }),
      ),
    [doc, eventBridge, identityLifecycle, options.pageId, tokenRuntime],
  );

  useAwareness(provider);
  useProviderLifecycle(provider, doc, eventBridge, options);
  useProviderDisposal(provider, doc);

  return { doc, provider };
}
