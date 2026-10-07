import type { EditorView } from '@codemirror/view';
import type { CommentAnchor, PageCommentThread } from '@metakip/shared';
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { commentAnchorKey, findCommentAnchorRange } from '../../editor/codemirror/commentAnchors';
import { layoutCommentCards } from '../../editor/codemirror/commentCardLayout';

type CommentSelectionPosition = { left: number; right: number; top: number; bottom: number };
type CommentSelection = { anchor: CommentAnchor; position: CommentSelectionPosition };
type PositionedCommentCard = { thread: PageCommentThread; top: number; right: number };

type UseEditorCommentsOptions = {
  wrapperRef: RefObject<HTMLDivElement | null>;
  commentAnchors: readonly CommentAnchor[];
  commentThreads: readonly PageCommentThread[];
  activeCommentAnchor: CommentAnchor | null;
  canComment: boolean;
  onCommentAnchorHoverChange?: (anchor: CommentAnchor | null) => void;
  onCommentSelection?: (anchor: CommentAnchor | null) => void;
};

function getCommentAnchorKeyFromTarget(target: EventTarget | null): string | null {
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return (
    element?.closest<HTMLElement>('[data-comment-anchor-key]')?.dataset.commentAnchorKey ?? null
  );
}

export function useEditorComments({
  wrapperRef,
  commentAnchors,
  commentThreads,
  activeCommentAnchor,
  canComment,
  onCommentAnchorHoverChange,
  onCommentSelection,
}: UseEditorCommentsOptions) {
  const [editor, setEditor] = useState<EditorView | null>(null);
  const [commentSelection, setCommentSelection] = useState<CommentSelection | null>(null);
  const [isCommentComposerOpen, setIsCommentComposerOpen] = useState(false);
  const [inlineCommentPositions, setInlineCommentPositions] = useState<PositionedCommentCard[]>([]);
  const inlineCommentHeightsRef = useRef(new Map<string, number>());

  const activeCommentAnchors = useMemo(() => {
    if (!commentSelection || !isCommentComposerOpen) return commentAnchors;
    return [
      ...commentAnchors.filter(
        (anchor) => commentAnchorKey(anchor) !== commentAnchorKey(commentSelection.anchor),
      ),
      commentSelection.anchor,
    ];
  }, [commentAnchors, commentSelection, isCommentComposerOpen]);
  const activeCommentAnchorKey = activeCommentAnchor ? commentAnchorKey(activeCommentAnchor) : null;

  const handleCommentSelection = useCallback(
    (anchor: CommentAnchor | null, position: CommentSelectionPosition | null) => {
      setCommentSelection(anchor && position ? { anchor, position } : null);
      if (!anchor || !position) setIsCommentComposerOpen(false);
      onCommentSelection?.(anchor);
    },
    [onCommentSelection],
  );
  const clearCommentSelection = useCallback(() => {
    setCommentSelection(null);
    setIsCommentComposerOpen(false);
    onCommentSelection?.(null);
  }, [onCommentSelection]);
  const closeCommentComposer = useCallback(() => {
    setIsCommentComposerOpen(false);
    onCommentSelection?.(null);
  }, [onCommentSelection]);

  useEffect(() => {
    if (canComment) return;
    setCommentSelection(null);
    setIsCommentComposerOpen(false);
    onCommentSelection?.(null);
  }, [canComment, onCommentSelection]);

  const updateInlineCommentPositions = useCallback(
    (view: EditorView | null) => {
      const wrapper = wrapperRef.current;
      if (!view || !wrapper || commentThreads.length === 0) {
        setInlineCommentPositions((current) => (current.length === 0 ? current : []));
        return;
      }
      const markdown = view.state.doc.toString();
      const scrollViewport = wrapper.closest<HTMLElement>('.overflow-x-hidden');
      const viewportRight = Math.min(
        document.documentElement.clientWidth,
        scrollViewport?.getBoundingClientRect().right ?? document.documentElement.clientWidth,
      );
      const right = wrapper.getBoundingClientRect().right - (viewportRight - 50);
      const positioned = commentThreads.flatMap((thread) => {
        const range = findCommentAnchorRange(markdown, thread.anchor);
        if (!range) return [];
        const documentY = view.documentTop + view.lineBlockAt(range.from).top;
        return [
          {
            thread,
            anchorTop: documentY - wrapper.getBoundingClientRect().top,
            right,
            anchorOffset: range.from,
          },
        ];
      });
      const spaced = layoutCommentCards(
        positioned.map((item) => ({
          value: item,
          anchorOffset: item.anchorOffset,
          anchorTop: item.anchorTop,
          height: inlineCommentHeightsRef.current.get(item.thread.id) ?? 84,
        })),
      ).map(({ value, top }) => ({ thread: value.thread, right: value.right, top }));
      setInlineCommentPositions(spaced);
    },
    [commentThreads, wrapperRef],
  );

  const handleInlineCommentCardHeightChange = useCallback(
    (threadId: string, height: number) => {
      const previousHeight = inlineCommentHeightsRef.current.get(threadId);
      if (height <= 0 || (previousHeight !== undefined && Math.abs(previousHeight - height) < 1))
        return;
      inlineCommentHeightsRef.current.set(threadId, height);
      updateInlineCommentPositions(editor);
    },
    [editor, updateInlineCommentPositions],
  );

  useLayoutEffect(() => {
    updateInlineCommentPositions(editor);
    const handleLayoutChange = () => updateInlineCommentPositions(editor);
    window.addEventListener('resize', handleLayoutChange);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handleLayoutChange);
    if (wrapperRef.current) observer?.observe(wrapperRef.current);
    editor?.dom.addEventListener('scroll', handleLayoutChange);
    return () => {
      window.removeEventListener('resize', handleLayoutChange);
      observer?.disconnect();
      editor?.dom.removeEventListener('scroll', handleLayoutChange);
    };
  }, [editor, updateInlineCommentPositions, wrapperRef]);

  useEffect(() => {
    if (!editor || !commentSelection) return undefined;
    const updatePosition = () => {
      const selection = editor.state.selection.main;
      const coordinates = editor.coordsAtPos(selection.to);
      if (!coordinates) return;
      setCommentSelection((current) =>
        current
          ? {
              ...current,
              position: {
                left: coordinates.left,
                right: coordinates.right,
                top: coordinates.top,
                bottom: coordinates.bottom,
              },
            }
          : current,
      );
    };
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [commentSelection, editor]);

  useEffect(() => {
    if (!editor) return undefined;
    const syncActiveAnchor = () => {
      for (const mark of editor.dom.querySelectorAll<HTMLElement>('.cm-comment-anchor')) {
        mark.classList.toggle(
          'cm-comment-anchor-active',
          activeCommentAnchorKey !== null &&
            mark.dataset.commentAnchorKey === activeCommentAnchorKey,
        );
      }
    };
    syncActiveAnchor();
    const observer = new MutationObserver(syncActiveAnchor);
    observer.observe(editor.dom, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [activeCommentAnchorKey, editor]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;
    const notifyAnchor = (anchorKey: string | null) => {
      const anchor =
        anchorKey === null
          ? null
          : (activeCommentAnchors.find((candidate) => commentAnchorKey(candidate) === anchorKey) ??
            null);
      onCommentAnchorHoverChange?.(anchor);
    };
    const handleMouseOver = (event: MouseEvent) => {
      const anchorKey = getCommentAnchorKeyFromTarget(event.target);
      if (anchorKey) notifyAnchor(anchorKey);
    };
    const handleMouseOut = (event: MouseEvent) => {
      notifyAnchor(getCommentAnchorKeyFromTarget(event.relatedTarget));
    };
    wrapper.addEventListener('mouseover', handleMouseOver);
    wrapper.addEventListener('mouseout', handleMouseOut);
    return () => {
      wrapper.removeEventListener('mouseover', handleMouseOver);
      wrapper.removeEventListener('mouseout', handleMouseOut);
    };
  }, [activeCommentAnchors, onCommentAnchorHoverChange, wrapperRef]);

  return {
    activeCommentAnchors,
    activeCommentAnchorKey,
    commentSelection,
    setIsCommentComposerOpen,
    isCommentComposerOpen,
    clearCommentSelection,
    closeCommentComposer,
    handleCommentSelection,
    updateInlineCommentPositions,
    inlineCommentPositions,
    handleInlineCommentCardHeightChange,
    setEditor,
  };
}
