import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type ChangeSpec, type EditorState, StateEffect, StateField } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type InlineKind = 'bold' | 'italic' | 'strike' | 'code';
type MarkRange = {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  delimiter: string;
};
type ActiveInlineMark = MarkRange & { kind: InlineKind };
type TextRange = { from: number; to: number };
const definitions = {
  bold: { node: 'StrongEmphasis', marker: 'EmphasisMark', delimiter: '**' },
  italic: { node: 'Emphasis', marker: 'EmphasisMark', delimiter: '*' },
  strike: { node: 'Strikethrough', marker: 'StrikethroughMark', delimiter: '~~' },
  code: { node: 'InlineCode', marker: 'CodeMark', delimiter: '`' },
} as const;

const setActiveInlineMark = StateEffect.define<ActiveInlineMark | null>();

/**
 * Tracks a formatting pair inserted by the editor until it is closed or the
 * caret leaves it. This covers the short period where Markdown has not yet
 * parsed a pair because its content ends in whitespace.
 */
export const inlineFormattingState = StateField.define<ActiveInlineMark | null>({
  create: () => null,
  update(active, transaction) {
    const effect = transaction.effects.find((candidate) => candidate.is(setActiveInlineMark));
    if (effect) return effect.value;
    if (!active) return null;

    const mapped: ActiveInlineMark = {
      ...active,
      from: transaction.changes.mapPos(active.from, -1),
      to: transaction.changes.mapPos(active.to, 1),
      contentFrom: transaction.changes.mapPos(active.contentFrom, -1),
      contentTo: transaction.changes.mapPos(active.contentTo, 1),
    };
    const selection = transaction.state.selection.main;
    const definition = definitions[active.kind];
    const hasDelimiters =
      transaction.state.sliceDoc(mapped.from, mapped.contentFrom) === definition.delimiter &&
      transaction.state.sliceDoc(mapped.contentTo, mapped.to) === definition.delimiter;
    if (
      !selection.empty ||
      selection.head < mapped.contentFrom ||
      selection.head > mapped.contentTo ||
      !hasDelimiters
    ) {
      return null;
    }
    return mapped;
  },
});

function matchingMarks(state: EditorState, kind: InlineKind): MarkRange[] {
  const { from, to, empty } = state.selection.main;
  const definition = definitions[kind];
  const matches: MarkRange[] = [];
  // A just-typed closing delimiter at the end of a document may not have been
  // parsed yet. Ensure the tree reaches the caret before deciding whether the
  // caret is inside an inline span; otherwise adding a trailing space appears
  // to make the toggle suddenly start working.
  const tree =
    ensureSyntaxTree(
      state,
      Math.min(state.doc.length, Math.max(from, to) + definition.delimiter.length),
    ) ?? syntaxTree(state);
  tree.iterate({
    from: Math.max(0, from - 1),
    to: Math.min(state.doc.length, to + 1),
    enter(node) {
      if (node.name !== definition.node) return undefined;
      const open = node.node.firstChild;
      const close = node.node.lastChild;
      if (
        !open ||
        !close ||
        open === close ||
        open.name !== definition.marker ||
        close.name !== definition.marker
      )
        return undefined;
      const containsSelection = node.from <= from && node.to >= to;
      const selectedWholeMark = !empty && from <= node.from && to >= node.to;
      const selectedContent = !empty && from <= open.to && to >= close.from;
      if (!containsSelection && !selectedWholeMark && !selectedContent) return undefined;
      let contentFrom = open.to;
      let contentTo = close.from;
      const content = state.sliceDoc(contentFrom, contentTo);
      if (kind === 'code' && content.startsWith(' ') && content.endsWith(' ') && content.trim()) {
        contentFrom += 1;
        contentTo -= 1;
      }
      matches.push({
        from: node.from,
        to: node.to,
        contentFrom,
        contentTo,
        delimiter: definition.delimiter,
      });
      return false;
    },
  });
  return matches;
}

function marksAtCursor(state: EditorState, kind: InlineKind): MarkRange[] {
  const marks = matchingMarks(state, kind);
  if (marks.length > 0) return marks;

  const active = state.field(inlineFormattingState, false);
  if (
    active?.kind !== kind ||
    active.contentFrom === active.contentTo ||
    !state.selection.main.empty ||
    state.selection.main.head < active.contentFrom ||
    state.selection.main.head > active.contentTo
  ) {
    return marks;
  }
  return [active];
}

function movePastMark(view: EditorView, mark: MarkRange): void {
  const content = view.state.sliceDoc(mark.contentFrom, mark.contentTo);
  const trailingWhitespace = mark.delimiter === '`' ? '' : (content.match(/[\t ]+$/)?.[0] ?? '');
  if (trailingWhitespace) {
    const whitespaceFrom = mark.contentTo - trailingWhitespace.length;
    view.dispatch({
      changes: {
        from: whitespaceFrom,
        to: mark.to,
        insert: mark.delimiter + trailingWhitespace,
      },
      selection: { anchor: mark.to },
      scrollIntoView: true,
      userEvent: 'input',
    });
    return;
  }
  view.dispatch({ selection: { anchor: mark.to }, scrollIntoView: true });
}

function wrapText(text: string, delimiter: string): string {
  const content = text.trim();
  if (!content) return text;
  const leading = text.length - text.trimStart().length;
  return `${text.slice(0, leading)}${delimiter}${content}${delimiter}${text.slice(leading + content.length)}`;
}

function blockPrefixLength(text: string): number {
  let offset = 0;
  for (;;) {
    const quote = text.slice(offset).match(/^ {0,3}>[\t ]?/);
    if (!quote) break;
    offset += quote[0].length;
  }

  const nestedBlockPrefix = text
    .slice(offset)
    .match(
      /^(?: {0,3}#{1,6}[\t ]+| *[-+*][\t ]+(?:\[[ xX]\][\t ]+)?| *\d+[.)][\t ]+(?:\[[ xX]\][\t ]+)?)/,
    );
  if (nestedBlockPrefix) {
    offset += nestedBlockPrefix[0].length;
    return offset + blockPrefixLength(text.slice(offset));
  }

  return offset;
}

function formattingExclusions(
  state: EditorState,
  selection: TextRange,
  kind: InlineKind,
): TextRange[] {
  const exclusions: TextRange[] = [];
  syntaxTree(state).iterate({
    from: selection.from,
    to: selection.to,
    enter(node) {
      const isCode =
        node.name === 'FencedCode' ||
        node.name === 'CodeBlock' ||
        (kind !== 'code' && node.name === 'InlineCode');
      const isTableDelimiter = node.name === 'TableDelimiter';
      if (isCode || isTableDelimiter) {
        exclusions.push({
          from: Math.max(selection.from, node.from),
          to: Math.min(selection.to, node.to),
        });
      }
    },
  });
  return exclusions.sort((left, right) => left.from - right.from);
}

function protectedLines(state: EditorState, selection: TextRange): Set<number> {
  const lines = new Set<number>();
  syntaxTree(state).iterate({
    from: selection.from,
    to: selection.to,
    enter(node) {
      const line = state.doc.lineAt(Math.max(selection.from, node.from));
      const isTableSeparator =
        node.name === 'TableDelimiter' && node.from === line.from && node.to === line.to;
      if (node.name === 'HorizontalRule' || node.name === 'HTMLBlock' || isTableSeparator) {
        const first = state.doc.lineAt(Math.max(selection.from, node.from)).number;
        const last = state.doc.lineAt(Math.min(selection.to, node.to)).number;
        for (let number = first; number <= last; number += 1) lines.add(number);
      }
      if (/^SetextHeading[12]$/.test(node.name)) {
        lines.add(state.doc.lineAt(node.to).number);
      }
    },
  });
  return lines;
}

function addInlineFormatting(
  state: EditorState,
  selection: TextRange,
  kind: InlineKind,
  delimiter: string,
): ChangeSpec[] {
  const exclusions = formattingExclusions(state, selection, kind);
  const excludedLines = protectedLines(state, selection);
  const changes: ChangeSpec[] = [];
  const addRange = (from: number, to: number) => {
    const text = state.sliceDoc(from, to);
    const content = text.trim();
    if (!content) return;
    const leading = text.length - text.trimStart().length;
    const contentFrom = from + leading;
    const contentTo = contentFrom + content.length;
    let fence = delimiter;
    let padding = '';
    if (kind === 'code') {
      const longestRun = Math.max(
        0,
        ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
      );
      fence = '`'.repeat(longestRun + 1);
      if (content.startsWith('`') || content.endsWith('`')) padding = ' ';
    }
    changes.push(
      { from: contentFrom, insert: fence + padding },
      { from: contentTo, insert: padding + fence },
    );
  };

  const firstLine = state.doc.lineAt(selection.from).number;
  const lastLine = state.doc.lineAt(selection.to).number;
  for (let number = firstLine; number <= lastLine; number += 1) {
    if (excludedLines.has(number)) continue;
    const line = state.doc.line(number);
    const from = Math.max(selection.from, line.from + blockPrefixLength(line.text));
    const to = Math.min(selection.to, line.to);
    if (from >= to) continue;

    let cursor = from;
    for (const exclusion of exclusions) {
      if (exclusion.to <= cursor) continue;
      if (exclusion.from >= to) break;
      if (exclusion.from > cursor) addRange(cursor, Math.min(exclusion.from, to));
      cursor = Math.max(cursor, exclusion.to);
      if (cursor >= to) break;
    }
    if (cursor < to) addRange(cursor, to);
  }
  return changes;
}

export function toggleInlineFormatting(view: EditorView, kind: InlineKind): void {
  const { state } = view;
  const selection = state.selection.main;
  const delimiter = definitions[kind].delimiter;
  const line = state.doc.lineAt(selection.head);
  // In particular, an empty strike pair (~~~~) parses as a code fence until typed into.
  if (
    selection.empty &&
    line.text === delimiter + delimiter &&
    selection.head === line.from + delimiter.length
  ) {
    view.dispatch({
      changes: { from: line.from, to: line.to },
      selection: { anchor: line.from },
      userEvent: 'input',
    });
    return;
  }
  let context = syntaxTree(state).resolveInner(selection.from, 1);
  for (;;) {
    // Formatting markup inside literal code would only insert visible punctuation.
    if (
      context.name === 'FencedCode' ||
      context.name === 'CodeBlock' ||
      (context.name === 'InlineCode' && kind !== 'code')
    )
      return;
    if (!context.parent) break;
    context = context.parent;
  }
  const marks = marksAtCursor(state, kind);
  const mark = marks[0];
  if (selection.empty && mark && selection.head === mark.contentTo) {
    // Toggling at the end changes where the next characters go, not the
    // formatting of the text that has already been written.
    movePastMark(view, mark);
    return;
  }
  if (selection.empty && mark && selection.head === mark.to) {
    view.dispatch({ selection: { anchor: mark.contentTo }, scrollIntoView: true });
    return;
  }
  if (selection.empty && mark) {
    // Keep the existing span intact, but create an unformatted insertion point
    // at the caret by splitting it into two adjacent spans.
    const markerPair = delimiter + delimiter;
    view.dispatch({
      changes: { from: selection.head, insert: markerPair },
      selection: { anchor: selection.head + delimiter.length },
      scrollIntoView: true,
      userEvent: 'input',
    });
    return;
  }
  if (
    marks.length === 1 &&
    mark &&
    !selection.empty &&
    selection.from >= mark.contentFrom &&
    selection.to <= mark.contentTo &&
    (selection.from > mark.contentFrom || selection.to < mark.contentTo) &&
    // Selecting the text in ***bold italic*** excludes the inner ** markers,
    // but still selects the whole visible span. Don't turn those markers into text.
    !(
      /^[*_~`\s]*$/.test(state.sliceDoc(mark.contentFrom, selection.from)) &&
      /^[*_~`\s]*$/.test(state.sliceDoc(selection.to, mark.contentTo))
    )
  ) {
    const before = wrapText(state.sliceDoc(mark.contentFrom, selection.from), delimiter);
    const selected = state.sliceDoc(selection.from, selection.to);
    const after = wrapText(state.sliceDoc(selection.to, mark.contentTo), delimiter);
    const from = mark.from + before.length;
    const to = from + selected.length;
    view.dispatch({
      changes: { from: mark.from, to: mark.to, insert: before + selected + after },
      selection:
        selection.anchor <= selection.head
          ? { anchor: from, head: to }
          : { anchor: to, head: from },
      scrollIntoView: true,
      userEvent: 'input',
    });
    return;
  }
  if (marks.length) {
    const changes = state.changes(
      marks.flatMap((range) => [
        { from: range.from, to: range.contentFrom },
        { from: range.contentTo, to: range.to },
      ]),
    );
    view.dispatch({
      changes,
      selection: state.selection.map(changes),
      scrollIntoView: true,
      userEvent: 'input',
    });
    return;
  }

  if (selection.empty) {
    const before = state.sliceDoc(Math.max(0, selection.from - delimiter.length), selection.from);
    const after = state.sliceDoc(
      selection.to,
      Math.min(state.doc.length, selection.to + delimiter.length),
    );
    // Cancel an empty pair inserted by the previous toggle, before it parses as a mark.
    if (before === delimiter && after === delimiter) {
      view.dispatch({
        changes: { from: selection.from - delimiter.length, to: selection.to + delimiter.length },
        selection: { anchor: selection.from - delimiter.length },
        userEvent: 'input',
        effects: setActiveInlineMark.of(null),
      });
    } else {
      const from = selection.from;
      view.dispatch({
        changes: { from: selection.from, insert: delimiter + delimiter },
        selection: { anchor: selection.from + delimiter.length },
        userEvent: 'input',
        effects: setActiveInlineMark.of({
          from,
          to: from + delimiter.length * 2,
          contentFrom: from + delimiter.length,
          contentTo: from + delimiter.length,
          delimiter,
          kind,
        }),
      });
    }
    return;
  }

  const changes = addInlineFormatting(state, selection, kind, delimiter);
  if (!changes.length) return;
  const changeSet = state.changes(changes);
  const from = changeSet.mapPos(selection.from, 1);
  const to = changeSet.mapPos(selection.to, -1);
  view.dispatch({
    changes: changeSet,
    selection:
      selection.anchor <= selection.head ? { anchor: from, head: to } : { anchor: to, head: from },
    scrollIntoView: true,
    userEvent: 'input',
  });
}

/** Move over a hidden closing delimiter when the caret is at the end of an inline span. */
export function movePastInlineFormatting(view: EditorView): boolean {
  if (view.state.readOnly) return false;

  const selection = view.state.selection.main;

  const candidates = (Object.keys(definitions) as InlineKind[]).flatMap((kind) =>
    marksAtCursor(view.state, kind).filter((mark) =>
      selection.empty
        ? mark.contentTo === selection.head
        : mark.contentFrom === selection.from && mark.contentTo === selection.to,
    ),
  );
  const mark = candidates.reduce<MarkRange | undefined>(
    (current, candidate) => (!current || candidate.to > current.to ? candidate : current),
    undefined,
  );
  if (!mark || mark.to <= selection.head) return false;

  movePastMark(view, mark);
  return true;
}
