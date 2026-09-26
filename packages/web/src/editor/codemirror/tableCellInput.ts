import type { Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';

/** At the end of an editable table cell, the next position is a hidden pipe.
 * In a CSS grid Chromium may type outside the cell mark, so CodeMirror can
 * read that character as belonging to the next Markdown row. Retain a source
 * space after the new character to keep the native caret inside the cell.
 */
export function insertAtTableCellBoundary(view: EditorView, event: InputEvent): boolean {
  if (
    view.state.readOnly ||
    view.composing ||
    event.isComposing ||
    !event.cancelable ||
    event.inputType !== 'insertText' ||
    !event.data ||
    /[\r\n]/.test(event.data)
  )
    return false;
  const selection = view.state.selection.main;
  if (!selection.empty) return false;

  const before = view.domAtPos(selection.head, -1).node;
  const element = before instanceof Element ? before : before.parentElement;
  const after = view.domAtPos(selection.head, 1).node;
  if (
    !element?.closest('.cm-md-table-cell') ||
    !(after instanceof HTMLElement) ||
    !after.matches('.cm-md-table > .cm-line')
  )
    return false;

  event.preventDefault();
  view.dispatch({
    changes: { from: selection.head, insert: `${event.data} ` },
    selection: { anchor: selection.head + event.data.length },
    scrollIntoView: true,
    userEvent: 'input.type',
  });
  return true;
}

export const tableCellInput: Extension = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      view.contentDOM.addEventListener('beforeinput', this.onBeforeInput, true);
    }

    private onBeforeInput = (event: InputEvent): void => {
      insertAtTableCellBoundary(this.view, event);
    };

    destroy(): void {
      this.view.contentDOM.removeEventListener('beforeinput', this.onBeforeInput, true);
    }
  },
);
