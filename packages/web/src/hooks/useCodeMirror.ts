import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { dropCursor, EditorView, highlightSpecialChars, keymap } from '@codemirror/view';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { GFM } from '@lezer/markdown';
import { useCallback, useEffect, useRef, useState } from 'react';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import {
  deleteEmptyCodeFence,
  exitCodeBlockOnEmptyFinalLine,
  handleCodeFenceInput,
  insertCodeBlockTab,
  pasteCodeBlockText,
} from '../components/editor/codeBlockCommands';
import { moveToAdjacentTableCell } from '../components/editor/editorTableCommands';
import { inlineFormattingState } from '../components/editor/inlineFormattingCommands';
import { collaborationCursors } from '../editor/codemirror/collaborationCursors';
import {
  type EditorHeading,
  extractEditorHeadings,
  getActiveHeadingIdInView,
  type HeadingWikiLinkResolver,
} from '../editor/codemirror/headings';
import { editorHighlightStyle } from '../editor/codemirror/highlightStyle';
import { livePreview } from '../editor/codemirror/livePreview';
import {
  mathMarkdownExtension,
  wikiLinkMarkdownExtension,
} from '../editor/codemirror/markdownSyntax';
import { getEditorSuggestionTrigger } from '../editor/codemirror/suggestionTriggers';
import { escapeMarkdownLinkLabel, markdownLink } from '../editor/codemirror/visualEditorTargets';
import {
  convertDelimitedToMarkdown,
  isLikelyMarkdown,
  isLikelyTableData,
} from '../editor/utils/markdownPaste';
import { routeEditorPaste } from '../editor/utils/pasteRouter';
import type { UrlPasteIntent } from '../editor/utils/urlPaste';
import type { WikiLinkNavigationTarget, WikiLinkReference } from '../editor/wikiLinkPresentations';
import { getLogger } from '../logger-init';

export type CodeMirrorInitializationState =
  | { status: 'initializing' }
  | { status: 'ready' }
  | { status: 'error'; error: unknown };

interface UseCodeMirrorProps {
  initialValue?: string;
  onChange?: (markdown: string) => void;
  doc?: Y.Doc;
  provider?: HocuspocusProvider;
  onWikiLinkClick?: ((target: WikiLinkNavigationTarget) => void) | undefined;
  onWikiLinkResolved?: ((reference: WikiLinkReference, title: string) => void) | undefined;
  onWikiLinkSuggest?: (
    isOpen: boolean,
    query: string,
    position: { x: number; y: number; top?: number; bottom?: number } | null,
  ) => void;
  onSlashMenuSuggest?: (
    isOpen: boolean,
    query: string,
    position: { x: number; y: number; top?: number; bottom?: number } | null,
    range: { from: number; to: number } | null,
  ) => void;
  readOnly?: boolean;
  onOutlineChange?: (headings: readonly EditorHeading[], activeHeadingId: string) => void;
  resolveHeadingWikiLink?: HeadingWikiLinkResolver;
}

function handleDividerInput(view: EditorView, from: number, to: number, text: string): boolean {
  if (from !== to || view.state.selection.main.from !== from) return false;
  const line = view.state.doc.lineAt(from);
  if (view.state.sliceDoc(from, line.to)) return false;
  const candidate = `${view.state.sliceDoc(line.from, from)}${text}`;
  if (candidate !== '---' && candidate !== '___ ' && candidate !== '*** ') return false;
  type TreeNode = { name: string; parent: TreeNode | null };
  let node: TreeNode | null = syntaxTree(view.state).resolveInner(from, -1) as TreeNode;
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'Blockquote' || node.name === 'ListItem') {
      return false;
    }
    node = node.parent;
  }
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: '---\n' },
    selection: { anchor: line.from + 4 },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

function insertText(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
  });
}

function isCodeContext(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const tree = syntaxTree(view.state);
  let containsCode = false;

  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeMark') {
        containsCode = true;
      }
    },
  });
  if (containsCode) return true;

  type TreeNode = { name: string; parent: TreeNode | null };
  const hasCodeAncestor = (position: number, side: -1 | 1): boolean => {
    let node: TreeNode | null = syntaxTree(view.state).resolveInner(position, side) as TreeNode;
    while (node) {
      if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeMark') {
        return true;
      }
      node = node.parent;
    }
    return false;
  };

  return hasCodeAncestor(from, -1) || hasCodeAncestor(to, 1);
}

const nonPlainMarkdown =
  /code|horizontalrule|html|link|comment|processing|escape|entity|image|mark|url|math|delimiter/i;

function selectionCrossesMarkdownSyntax(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  let crossesNode = false;
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (node.from > from || nonPlainMarkdown.test(node.name)) crossesNode = true;
    },
    leave(node) {
      if (node.to < to) crossesNode = true;
    },
  });
  return crossesNode;
}

function handleUrlPaste(view: EditorView, intent: UrlPasteIntent): boolean {
  if (isCodeContext(view)) return false;
  if (intent.kind === 'uri-list') {
    insertText(view, intent.urls.join('\n\n'));
    return true;
  }
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  if (selectionCrossesMarkdownSyntax(view)) return false;
  const label = view.state.sliceDoc(from, to);
  const link = markdownLink(label, intent.url);
  const escapedLabel = escapeMarkdownLinkLabel(label);
  view.dispatch({
    changes: { from, to, insert: link },
    selection:
      view.state.selection.main.anchor <= view.state.selection.main.head
        ? { anchor: from + 1, head: from + 1 + escapedLabel.length }
        : { anchor: from + 1 + escapedLabel.length, head: from + 1 },
    scrollIntoView: true,
    userEvent: 'input.paste',
  });
  return true;
}

export function useCodeMirror({
  initialValue,
  onChange,
  doc,
  provider,
  onWikiLinkClick,
  onWikiLinkResolved,
  onWikiLinkSuggest,
  onSlashMenuSuggest,
  onOutlineChange,
  resolveHeadingWikiLink,
  readOnly = false,
}: UseCodeMirrorProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [editor, setEditor] = useState<EditorView | null>(null);
  const [initializationState, setInitializationState] = useState<CodeMirrorInitializationState>({
    status: 'initializing',
  });
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const readOnlyRef = useRef(readOnly);
  const onChangeRef = useRef(onChange);
  const onWikiLinkSuggestRef = useRef(onWikiLinkSuggest);
  const onWikiLinkResolvedRef = useRef(onWikiLinkResolved);
  const onSlashMenuSuggestRef = useRef(onSlashMenuSuggest);
  const onOutlineChangeRef = useRef(onOutlineChange);
  const resolveHeadingWikiLinkRef = useRef(resolveHeadingWikiLink);
  onChangeRef.current = onChange;
  onWikiLinkSuggestRef.current = onWikiLinkSuggest;
  onWikiLinkResolvedRef.current = onWikiLinkResolved;
  onSlashMenuSuggestRef.current = onSlashMenuSuggest;
  onOutlineChangeRef.current = onOutlineChange;
  resolveHeadingWikiLinkRef.current = resolveHeadingWikiLink;
  readOnlyRef.current = readOnly;

  const retryInitialization = useCallback(() => {
    setInitializationState({ status: 'initializing' });
    setInitializationAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    if (!container) return undefined;
    void initializationAttempt;
    let view: EditorView | null = null;
    let undoManager: Y.UndoManager | null = null;
    let outlineTimer: number | undefined;
    let activeHeadingFrame: number | undefined;
    let currentHeadings: readonly EditorHeading[] = [];
    const publishOutline = (currentView: EditorView, parseDocument: boolean) => {
      if (!parseDocument) {
        onOutlineChangeRef.current?.(
          currentHeadings,
          getActiveHeadingIdInView(currentHeadings, currentView),
        );
        return;
      }
      if (outlineTimer !== undefined) window.clearTimeout(outlineTimer);
      outlineTimer = window.setTimeout(() => {
        currentHeadings = extractEditorHeadings(
          currentView.state.doc.toString(),
          resolveHeadingWikiLinkRef.current,
        );
        onOutlineChangeRef.current?.(
          currentHeadings,
          getActiveHeadingIdInView(currentHeadings, currentView),
        );
      }, 50);
    };
    const refreshActiveHeading = () => {
      if (activeHeadingFrame !== undefined) return;
      activeHeadingFrame = window.requestAnimationFrame(() => {
        activeHeadingFrame = undefined;
        if (view?.dom.isConnected) publishOutline(view, false);
      });
    };
    setInitializationState({ status: 'initializing' });
    try {
      const collaborativeText = doc?.getText('content');
      // Keep browser-native caret/selection, matching the previous editor (also over cell backgrounds).
      const extensions = [
        highlightSpecialChars(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        syntaxHighlighting(editorHighlightStyle, { fallback: true }),
        markdown({
          extensions: [GFM, wikiLinkMarkdownExtension, mathMarkdownExtension],
          completeHTMLTags: false,
          pasteURLAsLink: false,
        }),
        inlineFormattingState,
        livePreview({
          ...(onWikiLinkClick !== undefined ? { onWikiLinkClick } : {}),
          ...(resolveHeadingWikiLink !== undefined ? { resolveHeadingWikiLink } : {}),
          onWikiLinkResolved: (reference, title) => {
            onWikiLinkResolvedRef.current?.(reference, title);
            if (view) publishOutline(view, true);
          },
        }),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false', class: 'codemirror-editor-view' }),
        EditorView.exceptionSink.of((error) => {
          getLogger().error`CodeMirror extension failed: ${error}`;
        }),
        readOnlyCompartmentRef.current.of([
          EditorState.readOnly.of(readOnlyRef.current),
          EditorView.editable.of(!readOnlyRef.current),
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) publishOutline(update.view, true);
          else if (update.viewportChanged) publishOutline(update.view, false);
          if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          if (!update.docChanged && !update.selectionSet && !update.viewportChanged) return;
          const selection = update.state.selection.main;
          const trigger = getEditorSuggestionTrigger(update.state);
          if (!trigger) {
            onWikiLinkSuggestRef.current?.(false, '', null);
            onSlashMenuSuggestRef.current?.(false, '', null, null);
            return;
          }
          const coordinates = update.view.coordsAtPos(selection.head);
          const position = coordinates
            ? {
                x: coordinates.left,
                y: coordinates.bottom + 5,
                top: coordinates.top,
                bottom: coordinates.bottom,
              }
            : null;
          if (trigger.kind === 'wiki-link') {
            onWikiLinkSuggestRef.current?.(true, trigger.query, position);
            onSlashMenuSuggestRef.current?.(false, '', null, null);
            return;
          }
          onWikiLinkSuggestRef.current?.(false, '', null);
          onSlashMenuSuggestRef.current?.(true, trigger.query, position, {
            from: trigger.from,
            to: trigger.to,
          });
        }),
        EditorView.domEventHandlers({
          paste: (event, currentView) => {
            if (currentView.state.readOnly) return false;
            const text = event.clipboardData?.types.includes('text/plain')
              ? event.clipboardData.getData('text/plain')
              : undefined;
            if (text !== undefined && pasteCodeBlockText(currentView, text)) {
              event.preventDefault();
              return true;
            }
            const handled = routeEditorPaste(event.clipboardData, {
              handleUrl: (intent) => handleUrlPaste(currentView, intent),
              handleTable: (text) => insertText(currentView, convertDelimitedToMarkdown(text)),
              handleMarkdown: (text) => insertText(currentView, text.replace(/\r\n?/g, '\n')),
              isLikelyMarkdown,
              isLikelyTableData,
            });
            if (handled) event.preventDefault();
            return handled;
          },
        }),
        EditorView.inputHandler.of(handleDividerInput),
        EditorView.inputHandler.of(handleCodeFenceInput),
        Prec.highest(
          keymap.of([
            ...yUndoManagerKeymap,
            { key: 'Enter', run: exitCodeBlockOnEmptyFinalLine },
            { key: 'Backspace', run: deleteEmptyCodeFence },
            { key: 'Tab', run: (view) => moveToAdjacentTableCell(view, 1) },
            { key: 'Tab', run: insertCodeBlockTab },
            { key: 'Shift-Tab', run: (view) => moveToAdjacentTableCell(view, -1) },
          ]),
        ),
        // Mod-i belongs to italic in the app, not CodeMirror's select-parent-syntax command.
        keymap.of([...defaultKeymap.filter((binding) => binding.key !== 'Mod-i'), indentWithTab]),
      ];

      if (collaborativeText) {
        undoManager = new Y.UndoManager(collaborativeText);
        extensions.push(yCollab(collaborativeText, null, { undoManager }));
        if (provider?.awareness) {
          extensions.push(collaborationCursors(provider.awareness, collaborativeText));
        }
      }

      view = new EditorView({
        parent: container,
        state: EditorState.create({
          doc: collaborativeText?.toString() ?? initialValue ?? '',
          extensions,
        }),
      });
      // The app scrolls its main content pane rather than the window. Capture the
      // non-bubbling scroll event so the outline stays in sync with either one.
      window.addEventListener('scroll', refreshActiveHeading, { passive: true, capture: true });
      window.addEventListener('resize', refreshActiveHeading);
      view.scrollDOM.addEventListener('scroll', refreshActiveHeading, { passive: true });
      setEditor(view);
      publishOutline(view, true);
      setInitializationState({ status: 'ready' });
    } catch (error) {
      view?.destroy();
      undoManager?.destroy();
      setEditor(null);
      setInitializationState({ status: 'error', error });
    }
    return () => {
      setEditor((current) => (current === view ? null : current));
      if (outlineTimer !== undefined) window.clearTimeout(outlineTimer);
      if (activeHeadingFrame !== undefined) window.cancelAnimationFrame(activeHeadingFrame);
      window.removeEventListener('scroll', refreshActiveHeading, true);
      window.removeEventListener('resize', refreshActiveHeading);
      view?.scrollDOM.removeEventListener('scroll', refreshActiveHeading);
      onOutlineChangeRef.current?.([], '');
      view?.destroy();
      undoManager?.destroy();
    };
  }, [
    container,
    doc,
    initialValue,
    initializationAttempt,
    onWikiLinkClick,
    provider,
    resolveHeadingWikiLink,
  ]);

  useEffect(() => {
    if (!editor) return;
    editor.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [editor, readOnly]);

  return { setContainer, editor, initializationState, retryInitialization };
}
