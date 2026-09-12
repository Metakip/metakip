import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { type RefObject, useCallback, useState } from 'react';

export type EditorActiveStates = {
  isBoldActive: boolean;
  isItalicActive: boolean;
  isStrikeActive: boolean;
  isCodeActive: boolean;
  isLinkActive: boolean;
  isBlockquoteActive: boolean;
  isH1Active: boolean;
  isH2Active: boolean;
  isH3Active: boolean;
  isH4Active: boolean;
  isH5Active: boolean;
  isH6Active: boolean;
  isBulletListActive: boolean;
  isOrderedListActive: boolean;
  isTaskListActive: boolean;
  isInTableActive: boolean;
};

const INACTIVE_STATES: EditorActiveStates = {
  isBoldActive: false,
  isItalicActive: false,
  isStrikeActive: false,
  isCodeActive: false,
  isLinkActive: false,
  isBlockquoteActive: false,
  isH1Active: false,
  isH2Active: false,
  isH3Active: false,
  isH4Active: false,
  isH5Active: false,
  isH6Active: false,
  isBulletListActive: false,
  isOrderedListActive: false,
  isTaskListActive: false,
  isInTableActive: false,
};

type TreeNode = { name: string; to: number; parent: TreeNode | null };

function namesAtPosition(state: EditorState, position: number, side: -1 | 1 = -1): Set<string> {
  let node: TreeNode | null = syntaxTree(state).resolveInner(position, side) as TreeNode;
  const names = new Set<string>();
  while (node) {
    const inline = ['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode'].includes(
      node.name,
    );
    if (!inline || node.to !== position) names.add(node.name);
    node = node.parent;
  }
  return names;
}

type BlockFormat =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'code'
  | 'other';

const HEADING_FORMATS = [
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'heading-5',
  'heading-6',
] as const satisfies readonly BlockFormat[];

function blockFormatAtLine(state: EditorState, lineNumber: number): BlockFormat | null {
  const line = state.doc.line(lineNumber);
  if (!line.text.trim()) return null;
  const names = namesAtPosition(state, line.from, 1);
  for (let level = 1; level <= 6; level += 1) {
    if (names.has(`ATXHeading${level}`) || (level <= 2 && names.has(`SetextHeading${level}`))) {
      return HEADING_FORMATS[level - 1] ?? null;
    }
  }
  if (names.has('BulletList')) {
    return /^\s*[-+*]\s+\[[ xX]\]/.test(line.text) ? 'task' : 'bullet';
  }
  if (names.has('OrderedList')) return 'ordered';
  if (names.has('FencedCode') || names.has('CodeBlock')) return 'code';
  return 'other';
}

function selectedBlockFormat(state: EditorState): BlockFormat | null {
  const selection = state.selection.main;
  const firstLine = state.doc.lineAt(selection.from).number;
  const selectedThrough =
    selection.to > selection.from && state.doc.lineAt(selection.to).from === selection.to
      ? selection.to - 1
      : selection.to;
  const lastLine = state.doc.lineAt(selectedThrough).number;
  const formats = new Set<BlockFormat>();
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const format = blockFormatAtLine(state, lineNumber);
    if (format) formats.add(format);
  }
  return formats.size === 1 ? (formats.values().next().value ?? null) : null;
}

export function deriveActiveStates(state: EditorState): EditorActiveStates {
  const names = state.selection.main.empty
    ? namesAtPosition(state, state.selection.main.head)
    : (() => {
        const selected = new Set<string>();
        syntaxTree(state).iterate({
          from: state.selection.main.from,
          to: state.selection.main.to,
          enter(node) {
            selected.add(node.name);
          },
        });
        return selected;
      })();
  const blockFormat = selectedBlockFormat(state);
  return {
    isBoldActive: names.has('StrongEmphasis'),
    isItalicActive: names.has('Emphasis'),
    isStrikeActive: names.has('Strikethrough'),
    isCodeActive: names.has('InlineCode') || blockFormat === 'code',
    isLinkActive: names.has('Link') || names.has('Autolink'),
    isBlockquoteActive: names.has('Blockquote'),
    isH1Active: blockFormat === 'heading-1',
    isH2Active: blockFormat === 'heading-2',
    isH3Active: blockFormat === 'heading-3',
    isH4Active: blockFormat === 'heading-4',
    isH5Active: blockFormat === 'heading-5',
    isH6Active: blockFormat === 'heading-6',
    isBulletListActive: blockFormat === 'bullet',
    isOrderedListActive: blockFormat === 'ordered',
    isTaskListActive: blockFormat === 'task',
    isInTableActive: names.has('Table'),
  };
}

export function useEditorActiveStates(editorRef: RefObject<EditorView | null>): {
  activeStates: EditorActiveStates;
  updateActiveStates: () => void;
} {
  const [activeStates, setActiveStates] = useState(INACTIVE_STATES);
  const updateActiveStates = useCallback(() => {
    const editor = editorRef.current;
    if (editor) setActiveStates(deriveActiveStates(editor.state));
  }, [editorRef]);
  return { activeStates, updateActiveStates };
}
