import { history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { afterEach, describe, expect, it } from 'vitest';
import { livePreview } from './livePreview';
import { mathMarkdownExtension } from './markdownSyntax';
import { linkMarkdown, markdownLink } from './visualEditorTargets';

const views: EditorView[] = [];
function createView(doc: string, readOnly = false) {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [GFM, mathMarkdownExtension] }),
        livePreview(),
        history(),
        EditorState.readOnly.of(readOnly),
      ],
    }),
  });
  views.push(view);
  return view;
}
function button(selector: string): HTMLButtonElement {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing button: ${selector}`);
  return element;
}
function input(selector: string): HTMLInputElement | HTMLTextAreaElement {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement))
    throw new Error(`Missing input: ${selector}`);
  return element;
}
function hoverLink(view: EditorView) {
  const link = view.dom.querySelector('a.cm-md-link');
  if (!link) throw new Error('Missing rendered link');
  link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}
function editLink(view: EditorView) {
  hoverLink(view);
  button('.link-hover-tooltip-edit').click();
}
function mathClick(view: EditorView, altKey = false) {
  const math = view.dom.querySelector('.cm-md-math');
  if (!math) throw new Error('Missing math preview');
  math.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  math.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey }));
}
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

describe('original LinkEditor with CodeMirror', () => {
  it('escapes link labels and URL characters when creating Markdown links', () => {
    expect(markdownLink('Read [this] carefully', 'https://example.com/a (b)')).toBe(
      '[Read \\[this\\] carefully](https://example.com/a%20%28b%29)',
    );

    const target = {
      kind: 'link' as const,
      mode: 'new' as const,
      from: 0,
      to: 25,
      source: '**Read [this] carefully**',
      text: 'Read [this] carefully',
      rawLabel: '**Read [this] carefully**',
      url: '',
      labelFrom: 0,
      labelTo: 0,
      urlFrom: 0,
      urlTo: 0,
    };
    expect(linkMarkdown(target, target.text, 'https://example.com')).toBe(
      '[**Read \\[this\\] carefully**](https://example.com)',
    );
  });

  it('uses the original hover actions and popup, preserving Markdown on save and undo', () => {
    const source = 'Before [**Label**](https://old.example "Title") after';
    const view = createView(source);
    hoverLink(view);
    expect(
      [...document.querySelectorAll('.link-hover-tooltip button')].map((el) => el.textContent),
    ).toEqual(['Edit', 'Remove']);
    button('.link-hover-tooltip-edit').click();
    expect(
      [...document.querySelectorAll('.link-editor-popup button')].map((el) => el.textContent),
    ).toEqual(['Remove Link', 'Cancel', 'Save']);
    expect(input('.link-editor-input-text').value).toBe('Label');
    input('.link-editor-input-url').value = 'https://new.example';
    button('.link-editor-btn-save').click();
    expect(view.state.doc.toString()).toBe('Before [**Label**](https://new.example "Title") after');
    expect(document.querySelector('.link-editor-popup')).toBeNull();
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it.each([false, true])('removes links from the tooltip or popup (popup: %s)', (popup) => {
    const view = createView('Before [**Label**](https://example.com) after');
    hoverLink(view);
    if (popup) button('.link-hover-tooltip-edit').click();
    button(popup ? '.link-editor-btn-remove' : '.link-hover-tooltip-remove').click();
    expect(view.state.doc.toString()).toBe('Before **Label** after');
    expect(document.querySelector('.link-hover-tooltip, .link-editor-popup')).toBeNull();
  });

  it('does not relink a removed automatic URL', () => {
    const view = createView('Before https://example.com after');
    hoverLink(view);
    button('.link-hover-tooltip-remove').click();
    expect(view.dom.querySelector('a.cm-md-link')).toBeNull();
    expect(view.dom.textContent).toContain('Before https://example.com after');
  });

  it('retains the original URL validation and Escape cancellation', () => {
    const source = 'Before [Label](https://example.com) after';
    const view = createView(source);
    editLink(view);
    const url = input('.link-editor-input-url');
    url.value = 'javascript:alert(1)';
    button('.link-editor-btn-save').click();
    expect(url.validationMessage).toContain('safe');
    expect(view.state.doc.toString()).toBe(source);
    url.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.link-editor-popup')).toBeNull();
  });

  it('maps edits before the link and closes rather than overwriting a changed target', () => {
    const view = createView('Before [Label](https://old.example) after');
    editLink(view);
    input('.link-editor-input-url').value = 'https://new.example';
    view.dispatch({ changes: { from: 0, insert: 'Remote: ' } });
    button('.link-editor-btn-save').click();
    expect(view.state.doc.toString()).toBe('Remote: Before [Label](https://new.example) after');
    editLink(view);
    const save = button('.link-editor-btn-save');
    const from = view.state.doc.toString().indexOf('new.example');
    view.dispatch({ changes: { from, to: from + 11, insert: 'remote.example' } });
    expect(document.querySelector('.link-editor-popup')).toBeNull();
    save.click();
    expect(view.state.doc.toString()).toContain('https://remote.example');
  });

  it('does not open in read-only mode and cleans up when permissions change', () => {
    hoverLink(createView('Before [Label](https://example.com) after', true));
    expect(document.querySelector('.link-hover-tooltip')).toBeNull();
    const view = createView('Before [Label](https://example.com) after');
    editLink(view);
    view.dispatch({
      effects: StateEffect.reconfigure.of([
        markdown(),
        livePreview(),
        EditorState.readOnly.of(true),
      ]),
    });
    expect(document.querySelector('.link-editor-popup')).toBeNull();
  });
});

describe('original MathEditor with CodeMirror', () => {
  it.each([
    ['Before $x^2$ after', 'Before $x^3 + 1$ after'],
    ['Before\n\n$$\nx^2\n$$\nAfter', 'Before\n\n$$\nx^3 + 1\n$$\nAfter'],
  ])('uses the original textarea and Cancel/Done controls: %s', (source, expected) => {
    const view = createView(source);
    mathClick(view);
    expect(
      [...document.querySelectorAll('.math-editor-popup button')].map((el) => el.textContent),
    ).toEqual(['Cancel', 'Done']);
    expect(document.querySelector('.math-editor-popup .katex')).toBeNull();
    input('.math-editor-textarea').value = 'x^3 + 1';
    input('.math-editor-textarea').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe(expected);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it('keeps Shift+Enter for multiline input and Escape for cancellation', () => {
    const source = 'Before $x^2$ after';
    const view = createView(source);
    mathClick(view);
    const field = input('.math-editor-textarea');
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(document.querySelector('.math-editor-popup')).not.toBeNull();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.math-editor-popup')).toBeNull();
    expect(view.state.doc.toString()).toBe(source);
  });

  it('does not give Alt-click a separate source-editing behavior', () => {
    const view = createView('Before $x^2$ after');
    mathClick(view, true);
    expect(document.querySelector('.math-editor-popup')).not.toBeNull();
    expect(view.state.selection.main.head).toBe(0);
  });

  it('does not open in read-only mode', () => {
    mathClick(createView('Before $x^2$ after', true));
    expect(document.querySelector('.math-editor-popup')).toBeNull();
  });
});
