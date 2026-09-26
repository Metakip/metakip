import type { Extension, SelectionRange } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

type ScrollOptions = { y: 'nearest' | 'start' | 'end' | 'center'; yMargin: number };

function scrollParent(view: EditorView): HTMLElement | null {
  for (let parent = view.scrollDOM.parentElement; parent; parent = parent.parentElement) {
    if (/^(auto|scroll|overlay)$/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

/** A hidden pipe after a grid cell has no DOM coordinates. CodeMirror's
 * default side (+1) can report (0, 0) at that position and repeatedly scroll
 * the page toward the top by its caret margin. Measure the text side instead.
 */
export function scrollTableCaret(
  view: EditorView,
  range: SelectionRange,
  options: ScrollOptions,
): boolean {
  if (!range.empty || options.y !== 'nearest') return false;
  const before = view.domAtPos(range.head, -1);
  const element = before.node instanceof Element ? before.node : before.node.parentElement;
  if (!element?.closest('.cm-md-table-cell')) return false;
  const after = view.domAtPos(range.head, 1);
  if (!(after.node instanceof HTMLElement) || !after.node.matches('.cm-md-table > .cm-line'))
    return false;
  const parent = scrollParent(view);
  if (!parent) return false;

  // This callback runs *during* CodeMirror's measurement pass, where its
  // public coordsAtPos API throws. A DOM Range can measure the visible text
  // without recursively entering CodeMirror's layout reader.
  const selection = view.dom.ownerDocument.createRange();
  selection.setStart(before.node, before.offset);
  selection.collapse(true);
  const caret = selection.getBoundingClientRect();
  if (!caret.height) return false;

  const bounds = parent.getBoundingClientRect();
  const margin = options.yMargin;
  if (caret.top < bounds.top + margin) parent.scrollTop += caret.top - bounds.top - margin;
  else if (caret.bottom > bounds.bottom - margin)
    parent.scrollTop += caret.bottom - bounds.bottom + margin;
  return true;
}

export const tableCaretScroll: Extension = EditorView.scrollHandler.of(scrollTableCaret);
