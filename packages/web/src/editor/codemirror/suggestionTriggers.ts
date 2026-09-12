import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export type EditorSuggestionTrigger =
  | { kind: 'wiki-link'; query: string; from: number; to: number }
  | { kind: 'slash-command'; query: string; from: number; to: number };

const EXCLUDED_CONTEXTS = new Set([
  'Autolink',
  'CodeBlock',
  'FencedCode',
  'HTMLBlock',
  'HTMLTag',
  'InlineCode',
  'InlineMath',
  'Link',
  'URL',
]);

function allowsSuggestions(state: EditorState, position: number): boolean {
  type TreeNode = { name: string; parent: TreeNode | null };
  let node = syntaxTree(state).resolveInner(position, -1) as TreeNode | null;
  while (node) {
    if (EXCLUDED_CONTEXTS.has(node.name)) return false;
    node = node.parent;
  }
  return true;
}

function isEscaped(source: string, position: number): boolean {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function getEditorSuggestionTrigger(state: EditorState): EditorSuggestionTrigger | null {
  const selection = state.selection.main;
  if (!selection.empty || !allowsSuggestions(state, selection.head)) return null;

  const line = state.doc.lineAt(selection.head);
  const before = state.sliceDoc(line.from, selection.head);
  const wikiMatch = before.match(/\[\[([^\]]*)$/);
  if (wikiMatch) {
    const start = before.length - wikiMatch[0].length;
    if (before[start - 1] !== '!' && !isEscaped(before, start)) {
      return {
        kind: 'wiki-link',
        query: wikiMatch[1] ?? '',
        from: line.from + start,
        to: selection.head,
      };
    }
  }

  const slashMatch = before.match(/(?:^|\s)\/([^\s/]*)$/);
  if (!slashMatch) return null;
  return {
    kind: 'slash-command',
    query: slashMatch[1] ?? '',
    from: selection.head - (slashMatch[1]?.length ?? 0) - 1,
    to: selection.head,
  };
}
