import { StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import {
  COMMENT_ANCHOR_CONTEXT_MAX_LENGTH,
  COMMENT_ANCHOR_TEXT_MAX_LENGTH,
  type CommentAnchor,
} from '@metakip/shared';

export function anchorFromSelection(
  markdown: string,
  from: number,
  to: number,
): CommentAnchor | null {
  if (to <= from) return null;
  const quote = markdown.slice(from, to);
  if (!quote.trim() || quote.length > COMMENT_ANCHOR_TEXT_MAX_LENGTH) return null;
  return {
    quote,
    prefix: markdown.slice(Math.max(0, from - COMMENT_ANCHOR_CONTEXT_MAX_LENGTH), from),
    suffix: markdown.slice(to, to + COMMENT_ANCHOR_CONTEXT_MAX_LENGTH),
  };
}

export function commentAnchorKey(anchor: CommentAnchor): string {
  return JSON.stringify([anchor.quote, anchor.prefix ?? null, anchor.suffix ?? null]);
}

function decorationsFor(
  doc: { toString(): string },
  anchors: readonly CommentAnchor[],
): DecorationSet {
  const markdown = doc.toString();
  const ranges: ReturnType<Decoration['range']>[] = [];
  for (const anchor of anchors) {
    const range = findCommentAnchorRange(markdown, anchor);
    if (range) {
      ranges.push(
        Decoration.mark({
          class: 'cm-comment-anchor',
          attributes: { 'data-comment-anchor-key': commentAnchorKey(anchor) },
        }).range(range.from, range.to),
      );
    }
  }
  return Decoration.set(ranges, true);
}

export function findCommentAnchorRange(
  markdown: string,
  anchor: CommentAnchor,
): { from: number; to: number } | null {
  let match = -1;
  let count = 0;
  for (
    let index = markdown.indexOf(anchor.quote);
    index !== -1;
    index = markdown.indexOf(anchor.quote, index + 1)
  ) {
    if (
      (anchor.prefix == null || markdown.slice(0, index).endsWith(anchor.prefix)) &&
      (anchor.suffix == null ||
        markdown.slice(index + anchor.quote.length).startsWith(anchor.suffix))
    ) {
      match = index;
      count += 1;
      if (count > 1) return null;
    }
  }
  return count === 1 ? { from: match, to: match + anchor.quote.length } : null;
}

export function commentAnchorHighlight(anchors: readonly CommentAnchor[]) {
  const field = StateField.define<DecorationSet>({
    create: (state) => decorationsFor(state.doc, anchors),
    update: (decorations, transaction) =>
      transaction.docChanged
        ? decorationsFor(transaction.state.doc, anchors)
        : decorations.map(transaction.changes),
    provide: (stateField) => EditorView.decorations.from(stateField),
  });
  return [
    field,
    EditorView.baseTheme({
      '.cm-comment-anchor': {
        backgroundColor: 'rgba(161, 161, 170, 0.24)',
        transition: 'background-color 120ms ease',
      },
      '.cm-comment-anchor:hover, .cm-comment-anchor-active': {
        backgroundColor: 'rgba(250, 204, 21, 0.52)',
      },
    }),
  ];
}
