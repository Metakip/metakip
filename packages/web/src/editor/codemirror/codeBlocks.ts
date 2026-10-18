import type { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

type FencedCodeNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

export function codeBlockInfo(
  state: EditorState,
  node: FencedCodeNode,
): { from: number; to: number; language: string } | null {
  let child = node.firstChild;
  while (child) {
    if (child.name === 'CodeInfo') {
      return {
        from: child.from,
        to: child.to,
        language: (
          state.sliceDoc(child.from, child.to).trim().split(/\s+/, 1)[0] ?? ''
        ).toLowerCase(),
      };
    }
    child = child.nextSibling;
  }
  return null;
}

export function codeBlockRange(state: EditorState, node: FencedCodeNode) {
  const { from, to } = node;
  const first = state.doc.lineAt(from);
  const marks = node.getChildren('CodeMark');
  const opening = marks[0];
  const closing = marks[1];
  const fence = opening ? state.sliceDoc(opening.from, opening.to) : '```';
  // List markers belong on the opening line only; subsequent lines use indentation.
  const prefix = state
    .sliceDoc(first.from, from)
    .replace(/(?:[-+*]|\d+[.)])([ \t]+)/g, (marker) => ' '.repeat(marker.length));
  const closed = closing !== undefined;
  const contentFrom = Math.min(first.to + 1, to);
  return {
    from,
    to,
    fence,
    closed,
    opening: opening ? { from: opening.from, to: opening.to } : undefined,
    closing: closing ? { from: closing.from, to: closing.to } : undefined,
    prefix,
    contentFrom,
    contentTo: Math.max(contentFrom, closing ? state.doc.lineAt(closing.from).from - 1 : to),
  };
}

export type CodeBlockRange = ReturnType<typeof codeBlockRange>;

export function codePrefixLength(text: string, prefix: string): number {
  let offset = 0;
  const quotes = prefix.match(/>/g)?.length ?? 0;
  for (let depth = 0; depth < quotes; depth += 1) {
    const marker = text.slice(offset).match(/^[ \t]{0,3}>[ \t]?/);
    if (!marker) return offset;
    offset += marker[0].length;
  }
  const indentation = quotes
    ? prefix.slice(prefix.lastIndexOf('>') + 1).replace(/^[ \t]/, '')
    : prefix;
  for (let index = 0; index < indentation.length && /[ \t]/.test(text[offset] ?? ''); index += 1)
    offset += 1;
  return offset;
}

export function codeBlockText(state: EditorState, block: CodeBlockRange): string {
  return state
    .sliceDoc(block.contentFrom, block.contentTo)
    .split('\n')
    .map((line) => line.slice(codePrefixLength(line, block.prefix)))
    .join('\n');
}
