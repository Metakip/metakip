import type { EditorView } from '@codemirror/view';
import {
  type CommentAnchor,
  deriveCapabilities,
  normalizeWikiLinkLookupKey,
  type PageCommentThread,
  type ParsedWikiLinkTarget,
  type SharePermission,
} from '@metakip/shared';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsReadOnly, useSetReadOnly } from '../../contexts/EditorReadOnlyContext';
import { useIdentityLifecycle } from '../../contexts/IdentityLifecycleContext';
import { useSetCapabilities, useShareContext } from '../../contexts/ShareContext';
import { commentAnchorKey } from '../../editor/codemirror/commentAnchors';
import { type EditorHeading, scrollToEditorHeading } from '../../editor/codemirror/headings';
import {
  fetchWikiLinkPresentations,
  refreshWikiLinkPresentations,
  registerWikiLinkPresentationResolver,
  type WikiLinkNavigationTarget,
  type WikiLinkReference,
} from '../../editor/wikiLinkPresentations';
import { useAuth } from '../../hooks/useAuth';
import { useCodeMirror } from '../../hooks/useCodeMirror';
import { usePageCollaboration } from '../../hooks/useCollaborationLifecycle';
import { useFloatingToolbar } from '../../hooks/useFloatingToolbar';
import { useSlashMenu } from '../../hooks/useSlashMenu';
import { useWikiLinkSuggestions } from '../../hooks/useWikiLinkSuggestions';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { InlineCommentCard } from './InlineCommentCard';
import { InlineCommentComposer } from './InlineCommentComposer';
import { TableOfContents } from './TableOfContents';
import { useEditorActiveStates } from './useEditorActiveStates';
import './editor.css';
import type { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider';
import * as stylex from '@stylexjs/stylex';
import { uploadPageImage } from '../../utils/imageUpload';
import { styles } from './CodeMirrorEditor.stylex';
import { createEditorCommandRegistry } from './editorCommandRegistry';
import { createEditorFormattingCommands } from './editorFormattingCommands';
import { createEditorTableCommands } from './editorTableCommands';
import { FloatingToolbar } from './FloatingToolbar';
import { SlashMenu } from './SlashMenu';
import { useEditorComments } from './useEditorComments';
import { useEditorShortcuts } from './useEditorShortcuts';
import { WikiLinkSuggestions } from './WikiLinkSuggestions';

interface CodeMirrorEditorProps {
  pageId: string;
  initialValue?: string;
  onChange?: (markdown: string) => void;
  onProviderReady?: (provider: HocuspocusProvider) => void;
  onStatusChange?: (status: WebSocketStatus) => void;
  onDocumentReloadRequired?: () => void;
  onWikiLinkClick?: (target: WikiLinkNavigationTarget) => void;
  onPermissionSnapshot?: (permission: SharePermission | null, accessRevision: string) => void;
  requestedHeadingId?: string;
  commentAnchors?: readonly CommentAnchor[];
  commentThreads?: readonly PageCommentThread[];
  hideInlineCommentCards?: boolean;
  hideTableOfContents?: boolean;
  canComment?: boolean;
  canModerateComments?: boolean;
  activeCommentAnchor?: CommentAnchor | null;
  onCommentAnchorHoverChange?: (anchor: CommentAnchor | null) => void;
  onCommentSelection?: (anchor: CommentAnchor | null) => void;
  onCreateComment?: (anchor: CommentAnchor, body: string) => Promise<void>;
}

const WIKI_LINK_PRESENTATION_REVALIDATION_MS = 30_000;
const INITIAL_SYNC_TIMEOUT_MS = 10_000;
const EMPTY_COMMENT_THREADS: readonly PageCommentThread[] = [];
const EMPTY_COMMENT_ANCHORS: readonly CommentAnchor[] = [];

export function CodeMirrorEditor({
  pageId,
  initialValue,
  onChange,
  onStatusChange,
  onDocumentReloadRequired,
  onProviderReady,
  onWikiLinkClick,
  onPermissionSnapshot,
  requestedHeadingId,
  commentAnchors = EMPTY_COMMENT_ANCHORS,
  commentThreads = EMPTY_COMMENT_THREADS,
  hideInlineCommentCards = false,
  hideTableOfContents = false,
  canComment = false,
  canModerateComments = false,
  activeCommentAnchor = null,
  onCommentAnchorHoverChange,
  onCommentSelection,
  onCreateComment,
}: CodeMirrorEditorProps) {
  const editorRef = useRef<EditorView | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [initialContentReadyEditor, setInitialContentReadyEditor] = useState<EditorView | null>(
    null,
  );
  const [initialSyncError, setInitialSyncError] = useState(false);
  const [initialSyncAttempt, setInitialSyncAttempt] = useState(0);
  const [headings, setHeadings] = useState<readonly EditorHeading[]>([]);
  const [activeHeadingFrom, setActiveHeadingFrom] = useState<number | null>(null);
  const [isTableOfContentsHovered, setIsTableOfContentsHovered] = useState(false);
  useEffect(() => {
    if (hideTableOfContents) setIsTableOfContentsHovered(false);
  }, [hideTableOfContents]);
  const initialContentReadyRef = useRef(false);
  const { isAnonymous } = useShareContext();
  const { data: session } = useAuth();
  const currentUserId = session?.user?.id ?? null;
  const isReadOnly = useIsReadOnly();
  const setReadOnly = useSetReadOnly();
  const setCapabilities = useSetCapabilities();
  const identityLifecycle = useIdentityLifecycle();
  const uploadImage = useCallback(
    async (file: File, signal?: AbortSignal, idempotencyKey?: string) => {
      const identityRetired = () => {
        const error = new Error('The active identity changed during upload');
        error.name = 'AbortError';
        return error;
      };
      if (!identityLifecycle.isActive()) throw identityRetired();
      try {
        const result = await uploadPageImage(file, pageId, signal, idempotencyKey);
        if (!identityLifecycle.isActive()) throw identityRetired();
        return result;
      } catch (error) {
        if (!identityLifecycle.isActive()) throw identityRetired();
        throw error;
      }
    },
    [identityLifecycle, pageId],
  );
  const imageUploader = isAnonymous ? undefined : uploadImage;
  const queryClient = useQueryClient();
  const { doc, provider } = usePageCollaboration({
    pageId,
    editorRef,
    isAnonymous,
    currentUserId,
    ...(onStatusChange ? { onStatusChange } : {}),
    ...(onDocumentReloadRequired ? { onDocumentReloadRequired } : {}),
    ...(onPermissionSnapshot ? { onPermissionSnapshot } : {}),
  });
  const editorComments = useEditorComments({
    wrapperRef,
    commentAnchors,
    commentThreads,
    activeCommentAnchor,
    canComment,
    ...(onCommentAnchorHoverChange ? { onCommentAnchorHoverChange } : {}),
    ...(onCommentSelection ? { onCommentSelection } : {}),
  });

  const {
    suggestions,
    allPages,
    handleWikiLinkSuggest,
    handleWikiLinkSelect,
    handleAddPage,
    canAddPage,
    closeSuggestions,
  } = useWikiLinkSuggestions(editorRef, pageId);

  const headingWikiLinkPagesRef = useRef(allPages);
  headingWikiLinkPagesRef.current = allPages;
  const resolvedHeadingWikiLinkTitlesRef = useRef(new Map<string, string>());
  const headingWikiLinkPagesSignature = allPages
    .map((page) => `${page.id}:${page.title}`)
    .join('\n');
  const resolveHeadingWikiLink = useCallback((target: ParsedWikiLinkTarget) => {
    const key = target.targetId
      ? `id:${target.targetId.toLowerCase()}`
      : `path:${normalizeWikiLinkLookupKey(target.page)}`;
    const resolvedTitle = resolvedHeadingWikiLinkTitlesRef.current.get(key);
    if (resolvedTitle) return resolvedTitle;
    const pages = headingWikiLinkPagesRef.current;
    const targetId = target.targetId?.toLowerCase();
    const lookupKey = normalizeWikiLinkLookupKey(target.page);
    return pages.find(
      (page) =>
        (targetId !== undefined && page.id.toLowerCase() === targetId) ||
        (targetId === undefined && normalizeWikiLinkLookupKey(page.title) === lookupKey),
    )?.title;
  }, []);
  const handleWikiLinkResolved = useCallback((reference: WikiLinkReference, title: string) => {
    const key = reference.targetId
      ? `id:${reference.targetId.toLowerCase()}`
      : `path:${normalizeWikiLinkLookupKey(reference.path ?? '')}`;
    resolvedHeadingWikiLinkTitlesRef.current.set(key, title);
  }, []);

  const { activeStates, updateActiveStates } = useEditorActiveStates(editorRef);

  // The page API is useful for rendering metadata, but it is not authoritative
  // for a collaboration connection. Keep the editor fail-closed until this
  // provider receives its versioned permission snapshot.
  useLayoutEffect(() => {
    if (!pageId) return;
    setReadOnly(true);
    setCapabilities(deriveCapabilities(null));
  }, [pageId, setCapabilities, setReadOnly]);

  const handleSlashMenuSuggestRef = useRef<
    (
      isOpen: boolean,
      query: string,
      position: { x: number; y: number; top?: number; bottom?: number } | null,
      range: { from: number; to: number } | null,
    ) => void
  >(() => {});

  const {
    setContainer,
    editor,
    initializationState,
    retryInitialization,
    uploadImage: insertImage,
    refreshHeadingResolver,
  } = useCodeMirror({
    ...(initialValue !== undefined && { initialValue }),
    ...(onChange !== undefined && { onChange }),
    doc,
    provider,
    onWikiLinkClick,
    onWikiLinkResolved: handleWikiLinkResolved,
    onWikiLinkSuggest: handleWikiLinkSuggest,
    onSlashMenuSuggest: useCallback((isOpen, query, position, range) => {
      handleSlashMenuSuggestRef.current(isOpen, query, position, range);
    }, []),
    onOutlineChange: useCallback(
      (nextHeadings: readonly EditorHeading[], nextActiveHeadingFrom: number | null) => {
        setHeadings(nextHeadings);
        setActiveHeadingFrom(nextActiveHeadingFrom);
      },
      [],
    ),
    resolveHeadingWikiLink,
    commentAnchors: editorComments.activeCommentAnchors,
    onDocumentChange: editorComments.updateInlineCommentPositions,
    ...(onCommentSelection || onCreateComment
      ? { onCommentSelection: editorComments.handleCommentSelection }
      : {}),
    readOnly: isReadOnly,
    ...(imageUploader ? { onImageUpload: imageUploader } : {}),
  });

  useEffect(() => {
    if (initializationState.status !== 'ready' || !editor) return undefined;
    let frame: number | undefined;
    let timeout: number | undefined;
    let disposed = false;
    initialContentReadyRef.current = false;
    setInitialContentReadyEditor(null);
    setInitialSyncError(false);

    const failInitialSync = () => {
      if (disposed || initialContentReadyRef.current) return;
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      setInitialSyncError(true);
    };
    const markReady = () => {
      if (disposed) return;
      initialContentReadyRef.current = true;
      setInitialSyncError(false);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!disposed) setInitialContentReadyEditor(editor);
      });
    };
    const handleSynced = ({ state }: { state: boolean }) => {
      if (state) markReady();
    };

    if (provider.synced) {
      markReady();
    } else {
      provider.on('synced', handleSynced);
      timeout = window.setTimeout(failInitialSync, INITIAL_SYNC_TIMEOUT_MS);
      if (initialSyncAttempt > 0) {
        void provider
          .connect()
          .then(() => provider.forceSync())
          .catch(() => failInitialSync());
      }
    }

    return () => {
      disposed = true;
      provider.off('synced', handleSynced);
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [editor, initialSyncAttempt, initializationState.status, provider]);

  const handleInitialSyncRetry = useCallback(() => {
    initialContentReadyRef.current = false;
    setInitialSyncError(false);
    setInitialContentReadyEditor(null);
    setInitialSyncAttempt((attempt) => attempt + 1);
  }, []);

  const handleEditorLoadRetry = useCallback(() => {
    initialContentReadyRef.current = false;
    setInitialSyncError(false);
    setInitialContentReadyEditor(null);
    if (initializationState.status === 'error') {
      retryInitialization();
      return;
    }
    handleInitialSyncRetry();
  }, [handleInitialSyncRetry, initializationState.status, retryInitialization]);

  const editorLoadState: { status: 'loading' } | { status: 'error' } | { status: 'ready' } =
    initializationState.status === 'error' || initialSyncError
      ? { status: 'error' }
      : initializationState.status === 'ready' &&
          editor !== null &&
          initialContentReadyEditor === editor
        ? { status: 'ready' }
        : { status: 'loading' };
  const isEditorReady = editorLoadState.status === 'ready';
  const scrolledHeadingRef = useRef<{ editor: EditorView; id: string } | null>(null);

  useEffect(() => {
    if (!editor || !isEditorReady || !requestedHeadingId) return;
    const previous = scrolledHeadingRef.current;
    if (previous?.editor === editor && previous.id === requestedHeadingId) return;
    const heading = headings.find((candidate) => candidate.id === requestedHeadingId);
    if (!heading) return;
    scrollToEditorHeading(editor, heading);
    scrolledHeadingRef.current = { editor, id: requestedHeadingId };
  }, [editor, headings, isEditorReady, requestedHeadingId]);

  useEffect(() => {
    if (!editor) return;
    void headingWikiLinkPagesSignature;
    refreshHeadingResolver();
  }, [editor, headingWikiLinkPagesSignature, refreshHeadingResolver]);

  useEffect(() => {
    if (!editor) return undefined;
    let unregister: (() => void) | undefined;
    const refreshPresentations = () => {
      try {
        refreshWikiLinkPresentations(editor);
        queryClient.invalidateQueries({ queryKey: ['backlinks'] });
      } catch {
        // The editor may be retiring while the timer fires.
      }
    };
    try {
      unregister = registerWikiLinkPresentationResolver(editor, (requests) =>
        fetchWikiLinkPresentations(pageId, requests),
      );
    } catch {
      return undefined;
    }
    const interval = window.setInterval(
      refreshPresentations,
      WIKI_LINK_PRESENTATION_REVALIDATION_MS,
    );
    return () => {
      window.clearInterval(interval);
      unregister?.();
    };
  }, [editor, pageId, queryClient]);

  const { visible, position, keepVisible, reposition } = useFloatingToolbar();

  const formattingCommands = createEditorFormattingCommands({
    editor,
    keepVisible,
    reposition,
    updateActiveStates,
    ...(imageUploader ? { uploadImage: insertImage } : {}),
  });
  const tableCommands = createEditorTableCommands(editor, keepVisible, updateActiveStates);
  const editorCommands = createEditorCommandRegistry(
    { ...formattingCommands, ...tableCommands },
    !isAnonymous,
  );

  const { slashMenuState, handleSlashMenuSuggest, closeSlashMenu, slashCommands } = useSlashMenu(
    editorRef,
    { commands: editorCommands },
  );

  handleSlashMenuSuggestRef.current = handleSlashMenuSuggest;

  useEditorShortcuts(editor, isReadOnly, editorCommands);

  useEffect(() => {
    onProviderReady?.(provider);
  }, [provider, onProviderReady]);

  useEffect(() => {
    editorRef.current = editor;
    editorComments.setEditor(editor);
    return () => {
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [editor, editorComments.setEditor]);

  useEffect(() => {
    if (!editor) return;
    const editorInstanceRef = editor;
    let isMounted = true;

    const handleSelectionChange = () => {
      if (!isMounted) return;
      updateActiveStates();
    };

    editor.dom.addEventListener('keyup', handleSelectionChange);
    editor.dom.addEventListener('mouseup', handleSelectionChange);
    editor.dom.addEventListener('click', handleSelectionChange);

    return () => {
      isMounted = false;
      editorInstanceRef.dom.removeEventListener('keyup', handleSelectionChange);
      editorInstanceRef.dom.removeEventListener('mouseup', handleSelectionChange);
      editorInstanceRef.dom.removeEventListener('click', handleSelectionChange);
    };
  }, [editor, updateActiveStates]);

  const commentSelection = editorComments.commentSelection;
  const inlineCommentPositions = hideInlineCommentCards
    ? []
    : editorComments.inlineCommentPositions.filter(({ thread }) => thread.comments.length > 0);
  const hasInlineCommentRail = inlineCommentPositions.length > 0;

  return (
    <div
      ref={wrapperRef}
      className={`editor-wrapper ${stylex.props(styles.wrapper).className ?? ''} ${
        isReadOnly ? '' : 'editor-scroll-past-end'
      } ${isEditorReady ? '' : (stylex.props(styles.loadingAlignment).className ?? '')} ${
        hasInlineCommentRail ? 'editor-wrapper--with-inline-comment-rail' : ''
      }`}
      data-code-mirror-wrapper=""
    >
      {editorLoadState.status === 'error' ? (
        <div {...stylex.props(styles.errorState)} role="alert">
          <p {...stylex.props(styles.errorDescription)}>Couldn&apos;t load the page content.</p>
          <button
            type="button"
            onClick={handleEditorLoadRetry}
            {...stylex.props(styles.retryButton)}
          >
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : editorLoadState.status === 'loading' ? (
        <div {...stylex.props(styles.loadingOverlay)}>
          <LoadingIndicator label="Loading page" size="md" />
        </div>
      ) : null}
      {!isReadOnly && isEditorReady && (
        <>
          <WikiLinkSuggestions
            isOpen={suggestions.isOpen}
            query={suggestions.query}
            pages={allPages}
            position={suggestions.position}
            onSelect={handleWikiLinkSelect}
            onClose={closeSuggestions}
            {...(canAddPage ? { onAddPage: handleAddPage } : {})}
          />
          <SlashMenu
            isOpen={slashMenuState.isOpen}
            query={slashMenuState.query}
            position={slashMenuState.position}
            commands={slashCommands}
            onClose={closeSlashMenu}
          />
        </>
      )}
      {isEditorReady && (!isReadOnly || canComment) && (
        <FloatingToolbar
          visible={
            visible &&
            !editorComments.isCommentComposerOpen &&
            (!isReadOnly || commentSelection !== null)
          }
          position={position}
          onInteractionStart={keepVisible}
          onAddComment={() => editorComments.setIsCommentComposerOpen(true)}
          canComment={canComment && commentSelection !== null}
          commentOnly={isReadOnly}
          commands={editorCommands}
          activeStates={activeStates}
        />
      )}
      <div
        ref={setContainer}
        className={`codemirror-editor ${isEditorReady ? '' : (stylex.props(styles.editorNotReady).className ?? '')}`}
      />
      {hasInlineCommentRail && (
        <div className="inline-comment-card-rail" data-inline-comment-rail="">
          {!isTableOfContentsHovered &&
            inlineCommentPositions.map(({ thread, top }) => {
              const anchor = thread.anchor;
              const anchorKey = commentAnchorKey(anchor);
              return (
                <InlineCommentCard
                  key={thread.id}
                  pageId={pageId}
                  thread={thread}
                  anchorKey={anchorKey}
                  currentUserId={currentUserId}
                  canComment={canComment}
                  canModerate={canModerateComments}
                  active={editorComments.activeCommentAnchorKey === anchorKey}
                  onHoverChange={(hovered) =>
                    onCommentAnchorHoverChange?.(hovered ? thread.anchor : null)
                  }
                  onHeightChange={editorComments.handleInlineCommentCardHeightChange}
                  style={{ top, right: 0 }}
                />
              );
            })}
        </div>
      )}
      {editorComments.isCommentComposerOpen &&
        commentSelection &&
        onCreateComment &&
        canComment && (
          <InlineCommentComposer
            key={`${commentSelection.anchor.prefix ?? ''}:${commentSelection.anchor.quote}:${commentSelection.anchor.suffix ?? ''}`}
            position={commentSelection.position}
            onSubmit={async (body) => {
              await onCreateComment(commentSelection.anchor, body);
              editorComments.clearCommentSelection();
            }}
            onCancel={editorComments.closeCommentComposer}
          />
        )}
      {!hideTableOfContents && (
        <TableOfContents
          headings={headings}
          activeHeadingFrom={activeHeadingFrom}
          onHoverChange={setIsTableOfContentsHovered}
          onHeadingSelect={(heading) => {
            if (editor) scrollToEditorHeading(editor, heading);
          }}
        />
      )}
    </div>
  );
}
