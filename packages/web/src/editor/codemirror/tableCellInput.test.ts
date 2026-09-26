import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { livePreview } from './livePreview';
import { insertAtTableCellBoundary } from './tableCellInput';

const source = '| A | B |\n| --- | --- |\n| one | text|\n\nParagraph';
const views: EditorView[] = [];

afterEach(() => {
  for (const view of views) view.destroy();
  views.length = 0;
  document.body.replaceChildren();
});

function createView(): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [markdown({ extensions: [GFM] }), livePreview()],
    }),
  });
  views.push(view);
  return view;
}

describe('typing at a table cell boundary', () => {
  it('retains a trailing space so subsequent input stays inside the intended cell', () => {
    const view = createView();
    const position = source.indexOf('text|') + 4;
    view.dispatch({ selection: { anchor: position } });
    const event = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'x',
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.line(3).text).toBe('| one | textx |');
    expect(view.state.doc.line(5).text).toBe('Paragraph');
    expect(view.state.selection.main.head).toBe(position + 1);
    expect(view.domAtPos(position + 1, 1).node.parentElement).toHaveClass('cm-md-table-cell');
  });

  it('does not intercept input in paragraphs or IME composition', () => {
    const view = createView();
    const paragraph = source.indexOf('Paragraph');
    view.dispatch({ selection: { anchor: paragraph } });
    const normal = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'x',
      cancelable: true,
    });
    expect(insertAtTableCellBoundary(view, normal)).toBe(false);

    view.dispatch({ selection: { anchor: source.indexOf('text|') + 4 } });
    const composing = new InputEvent('beforeinput', {
      inputType: 'insertCompositionText',
      data: 'あ',
      cancelable: true,
      isComposing: true,
    });
    expect(insertAtTableCellBoundary(view, composing)).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  });
});
