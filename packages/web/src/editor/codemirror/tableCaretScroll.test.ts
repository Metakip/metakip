import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { livePreview } from './livePreview';
import { scrollTableCaret } from './tableCaretScroll';

const source = '| A | B |\n| --- | --- |\n| one | text|\n\nParagraph';
const views: EditorView[] = [];
const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');

afterEach(() => {
  for (const view of views) view.destroy();
  views.length = 0;
  vi.restoreAllMocks();
  if (originalRangeRect)
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  document.body.replaceChildren();
});

function createView() {
  const pane = document.body.appendChild(document.createElement('div'));
  pane.style.overflowY = 'auto';
  pane.scrollTop = 200;
  const view = new EditorView({
    parent: pane,
    state: EditorState.create({
      doc: source,
      extensions: [markdown({ extensions: [GFM] }), livePreview()],
    }),
  });
  views.push(view);
  return { view, pane };
}

function measureCaret(top: number, bottom: number): void {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top, bottom, height: bottom - top }) as DOMRect,
  });
}

describe('table caret scrolling', () => {
  it('uses the text side of a hidden pipe instead of CodeMirror’s unmeasurable grid boundary', () => {
    const { view, pane } = createView();
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 600 } as DOMRect);
    const coords = vi.spyOn(view, 'coordsAtPos').mockImplementation(() => {
      throw new Error('Cannot read CodeMirror layout during measurement');
    });
    measureCaret(300, 320);
    const atPipe = EditorSelection.cursor(source.indexOf('text|') + 4);
    expect(scrollTableCaret(view, atPipe, { y: 'nearest', yMargin: 5 })).toBe(true);
    expect(pane.scrollTop).toBe(200);
    expect(coords).not.toHaveBeenCalled();

    measureCaret(610, 630);
    expect(scrollTableCaret(view, atPipe, { y: 'nearest', yMargin: 5 })).toBe(true);
    expect(pane.scrollTop).toBe(235);
  });

  it('leaves ordinary text and non-nearest scrolling to CodeMirror', () => {
    const { view, pane } = createView();
    const paragraph = EditorSelection.cursor(source.indexOf('Paragraph'));
    const table = EditorSelection.cursor(source.indexOf('text|') + 4);
    expect(scrollTableCaret(view, paragraph, { y: 'nearest', yMargin: 5 })).toBe(false);
    expect(scrollTableCaret(view, table, { y: 'start', yMargin: 5 })).toBe(false);
    expect(pane.scrollTop).toBe(200);
  });
});
