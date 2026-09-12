import { getIndentUnit, syntaxTree } from '@codemirror/language';
import { countColumn, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export function codeBlockRange(state: EditorState, from: number, to: number) {
  const first = state.doc.lineAt(from);
  let node = syntaxTree(state).resolveInner(from, 1);
  while (node.parent && node.name !== 'FencedCode') node = node.parent;
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

type CodeBlockRange = ReturnType<typeof codeBlockRange>;

function codePrefixLength(text: string, prefix: string): number {
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

export function selectedCodeBlock(state: EditorState): ReturnType<typeof codeBlockRange> | null {
  const selection = state.selection.main;
  for (const side of [1, -1] as const) {
    let node = syntaxTree(state).resolveInner(selection.from, side);
    for (;;) {
      if (node.name === 'FencedCode' && node.to >= selection.to) {
        return codeBlockRange(state, node.from, node.to);
      }
      if (!node.parent) break;
      node = node.parent;
    }
  }
  return null;
}

/** Leave a fenced code block after the user creates an empty final line. */
export function exitCodeBlockOnEmptyFinalLine(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (state.readOnly || !selection.empty) return false;

  const block = selectedCodeBlock(state);
  if (!block?.closing) return false;

  const line = state.doc.lineAt(selection.head);
  const closingLine = state.doc.lineAt(block.closing.from);
  if (
    line.number + 1 !== closingLine.number ||
    selection.head !== line.to ||
    line.text.trim() !== ''
  ) {
    return false;
  }

  const changes = state.changes([
    // Remove the empty final code line and the newline before the closing fence.
    { from: line.from, to: closingLine.from },
    // Put the caret on a new paragraph after the closing fence.
    { from: closingLine.to, insert: state.lineBreak },
  ]);
  view.dispatch({
    changes,
    selection: { anchor: changes.mapPos(closingLine.to, 1) },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

export function handleCodeFenceInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  const { state } = view;
  if (state.readOnly || from !== to || !state.selection.main.empty || !/^[`~]+$/.test(text))
    return false;
  const line = state.doc.lineAt(from);
  if (from !== line.to) return false;
  const existing = selectedCodeBlock(state);
  if (existing) {
    // Lengthening an opening fence must lengthen its paired closing fence too.
    if (
      !existing.closing ||
      existing.opening?.to !== from ||
      state.doc.lineAt(existing.from).number !== line.number ||
      !text.split('').every((character) => character === existing.fence[0])
    )
      return false;
    const fence = existing.fence + text;
    view.dispatch({
      changes: [
        { from, insert: text },
        { from: existing.closing.from, to: existing.closing.to, insert: fence },
      ],
      selection: { anchor: from + text.length },
      userEvent: 'input.type',
    });
    return true;
  }
  // Inspect the prospective syntax without rendering an unclosed fence even
  // for one frame: it would temporarily turn all following paragraphs into code.
  const next = state.update({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
  }).state;
  const block = selectedCodeBlock(next);
  if (!block || next.doc.lineAt(block.from).number !== line.number) return false;
  view.dispatch({
    changes: { from, to, insert: `${text}\n${block.prefix}${block.fence}` },
    // Stay on the opening line so a language can still be typed; Enter enters the body.
    selection: { anchor: from + text.length },
    scrollIntoView: true,
    userEvent: 'input.type',
  });
  return true;
}

export function deleteEmptyCodeFence(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  const block = selectedCodeBlock(state);
  if (state.readOnly || !selection.empty || !block?.closing || block.opening?.to !== selection.head)
    return false;
  const line = state.doc.lineAt(selection.head);
  if (selection.head !== line.to || state.doc.lineAt(block.to).number !== line.number + 1)
    return false;
  view.dispatch({
    changes:
      block.fence.length === 3
        ? { from: selection.head - 1, to: state.doc.lineAt(block.to).to }
        : [
            { from: selection.head - 1, to: selection.head },
            { from: block.closing.to - 1, to: block.closing.to },
          ],
    selection: { anchor: selection.head - 1 },
    userEvent: 'delete.backward',
  });
  return true;
}

function selectedCodeBody(state: EditorState): CodeBlockRange | null {
  const block = selectedCodeBlock(state);
  const { from, to } = state.selection.main;
  if (block?.closing && from >= state.doc.lineAt(block.closing.from).from) return null;
  return block && from >= block.contentFrom && to <= block.contentTo ? block : null;
}

export function insertCodeBlockTab(view: EditorView): boolean {
  const { state } = view;
  const block = selectedCodeBody(state);
  if (state.readOnly || !state.selection.main.empty || !block) return false;
  const { head } = state.selection.main;
  const unit = getIndentUnit(state);
  const line = state.doc.lineAt(head);
  const column = countColumn(
    state.sliceDoc(line.from + codePrefixLength(line.text, block.prefix), head),
    state.tabSize,
  );
  const insert = ' '.repeat(unit - (column % unit));
  view.dispatch({
    changes: { from: head, insert },
    selection: { anchor: head + insert.length },
    userEvent: 'input',
  });
  return true;
}

export function pasteCodeBlockText(view: EditorView, text: string): boolean {
  const { state } = view;
  const block = selectedCodeBody(state);
  if (state.readOnly || !block) return false;
  const { from, to } = state.selection.main;
  const insert = text.replace(/\r\n?/g, '\n').replace(/\n/g, `\n${block.prefix}`);
  const body =
    state.sliceDoc(block.contentFrom, from) + insert + state.sliceDoc(to, block.contentTo);
  let length = block.fence.length;
  for (const run of body.matchAll(block.fence.startsWith('`') ? /`+/g : /~+/g))
    length = Math.max(length, run[0].length + 1);
  const fence = block.fence[0]?.repeat(length) ?? block.fence;
  const changes = state.changes([
    ...(length > block.fence.length && block.opening
      ? [{ from: block.opening.from, to: block.opening.to, insert: fence }]
      : []),
    { from, to, insert },
    ...(length > block.fence.length && block.closing
      ? [{ from: block.closing.from, to: block.closing.to, insert: fence }]
      : []),
  ]);
  view.dispatch({
    changes,
    selection: { anchor: changes.mapPos(from, -1) + insert.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
  });
  return true;
}

export function toggleCodeBlock(view: EditorView): void {
  const { state } = view;
  if (state.readOnly) return;
  const selection = state.selection.main;
  const block = selectedCodeBlock(state);
  if (block) {
    const firstBodyLine = state.doc.lineAt(block.contentFrom);
    const start = Math.min(
      block.contentTo,
      block.contentFrom + codePrefixLength(firstBodyLine.text, block.prefix),
    );
    const changes = state.changes([
      { from: block.from, to: start },
      { from: block.contentTo, to: block.to },
    ]);
    view.dispatch({
      changes,
      selection: state.selection.map(changes),
      scrollIntoView: true,
      userEvent: 'input',
    });
    return;
  }
  const first = state.doc.lineAt(selection.from);
  const last = state.doc.lineAt(selection.to);
  const from = selection.empty ? first.from : selection.from;
  const to = selection.empty ? first.to : selection.to;
  const content = state.sliceDoc(from, to);
  let longestRun = 2;
  for (const run of content.matchAll(/`+/g)) longestRun = Math.max(longestRun, run[0].length);
  const fence = '`'.repeat(longestRun + 1);
  const before = from > first.from ? '\n' : '';
  const after = to < last.to ? '\n' : '';
  const contentFrom = from + before.length + fence.length + 1;
  view.dispatch({
    changes: { from, to, insert: `${before}${fence}\n${content}\n${fence}${after}` },
    selection: selection.empty
      ? { anchor: contentFrom + selection.head - from }
      : selection.anchor <= selection.head
        ? { anchor: contentFrom, head: contentFrom + content.length }
        : { anchor: contentFrom + content.length, head: contentFrom },
    scrollIntoView: true,
    userEvent: 'input',
  });
}
