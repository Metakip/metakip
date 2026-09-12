import { history, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  codeBlockText,
  deleteEmptyCodeFence,
  exitCodeBlockOnEmptyFinalLine,
  handleCodeFenceInput,
  insertCodeBlockTab,
  pasteCodeBlockText,
  selectedCodeBlock,
  toggleCodeBlock,
} from './codeBlockCommands';

const views: EditorView[] = [];
function createView(doc: string, anchor = doc.length, head = anchor, readOnly = false) {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [markdown(), history(), EditorState.readOnly.of(readOnly)],
    }),
  });
  views.push(view);
  return view;
}
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe('code blocks', () => {
  it.each([
    '```',
    '~~~',
  ])('pairs a typed %s immediately without capturing the text below', (fence) => {
    const source = `${fence.slice(0, 2)}\nExisting paragraph\n# Heading\n\nMore text`;
    const view = createView(source, 2);
    expect(handleCodeFenceInput(view, 2, 2, fence.slice(2))).toBe(true);
    expect(view.state.doc.toString()).toBe(
      `${fence}\n${fence}\nExisting paragraph\n# Heading\n\nMore text`,
    );
    expect(view.state.selection.main.head).toBe(3);
    expect(selectedCodeBlock(view.state)?.to).toBe(7);
  });

  it('does not use another code block below as the new closing fence', () => {
    const view = createView('``\nParagraph\n```js\nexisting code\n```', 2);
    expect(handleCodeFenceInput(view, 2, 2, '`')).toBe(true);
    expect(view.state.doc.toString()).toBe('```\n```\nParagraph\n```js\nexisting code\n```');
  });

  it('keeps a longer typed fence paired', () => {
    const view = createView('``\nParagraph', 2);
    handleCodeFenceInput(view, 2, 2, '`');
    expect(handleCodeFenceInput(view, 3, 3, '`')).toBe(true);
    expect(view.state.doc.toString()).toBe('````\n````\nParagraph');
    expect(selectedCodeBlock(view.state)?.closed).toBe(true);
    expect(deleteEmptyCodeFence(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```\n```\nParagraph');
    expect(deleteEmptyCodeFence(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('``\nParagraph');
  });

  it('does not auto-pair backticks typed inside literal code', () => {
    const source = '````\n``\n````\nParagraph';
    const view = createView(source, 7);
    expect(handleCodeFenceInput(view, 7, 7, '`')).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
  });

  it('pairs an indented quoted opener without moving the following text', () => {
    const source = '>   ``\n> Paragraph';
    const view = createView(source, 6);
    expect(handleCodeFenceInput(view, 6, 6, '`')).toBe(true);
    expect(view.state.doc.toString()).toBe('>   ```\n>   ```\n> Paragraph');
  });

  it.each([
    ['```js\none\n\nlast\n```', 'one\n\nlast'],
    ['  ```\n  one\n    two\n  ```', 'one\n  two'],
    ['> ```\n> one\n>\n>   two\n> ```', 'one\n\n  two'],
    ['- ```\n  one\n    two\n  ```', 'one\n  two'],
    ['> - ```\n>   one\n>     two\n>   ```', 'one\n  two'],
    ['~~~\none\n\n~~~', 'one\n'],
    ['```\none\nlast', 'one\nlast'],
  ])('extracts only code, preserving relative whitespace: %s', (source, expected) => {
    const view = createView(source, source.indexOf('one'));
    const block = selectedCodeBlock(view.state);
    expect(block).not.toBeNull();
    if (block) expect(codeBlockText(view.state, block)).toBe(expected);
  });

  it.each([
    ['> ```\n> one\n> two\n> ```', '> one\n> two'],
    ['- ```\n  one\n  two\n  ```', '- one\n  two'],
    ['  ```\n  one\n    two\n  ```', '  one\n    two'],
  ])('unwraps without duplicating container markers: %s', (source, expected) => {
    const view = createView(source, source.indexOf('one'));
    toggleCodeBlock(view);
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.head).toBe(expected.indexOf('one'));
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it('preserves selection direction when wrapping', () => {
    const view = createView('first\nlast', 10, 0);
    toggleCodeBlock(view);
    expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      'first\nlast',
    );
  });

  it('inserts a tab stop at the cursor instead of indenting the entire line', () => {
    const view = createView('```\nabc\n```', 5);
    expect(insertCodeBlockTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```\na bc\n```');
    expect(view.state.selection.main.head).toBe(6);
  });

  it.each([
    'a\tb\r\n1\t2',
    'https://example.com',
    '# heading\n**literal**',
    '```\nexample\n```',
  ])('pastes literal code safely: %s', (text) => {
    const source = '```js\nold\n```';
    const view = createView(source, 6, 9);
    expect(pasteCodeBlockText(view, text)).toBe(true);
    const block = selectedCodeBlock(view.state);
    expect(block?.closed).toBe(true);
    if (block) expect(codeBlockText(view.state, block)).toBe(text.replace(/\r\n/g, '\n'));
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  });

  it('keeps multiline paste inside a quoted code block', () => {
    const source = '> ```\n> old\n> ```';
    const view = createView(source, 8, 11);
    expect(pasteCodeBlockText(view, 'one\ntwo')).toBe(true);
    expect(view.state.doc.toString()).toBe('> ```\n> one\n> two\n> ```');
  });

  it('does not handle paste on a closing fence as code content', () => {
    const view = createView('```\n```', 4);
    expect(pasteCodeBlockText(view, 'hello')).toBe(false);
  });

  it('exits after Enter on an empty final code line', () => {
    const view = createView('```js\ncode\n\n```', 11);

    expect(exitCodeBlockOnEmptyFinalLine(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```js\ncode\n```\n');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it('does not exit from a non-empty or unfinished code line', () => {
    const nonEmpty = createView('```\ncode\n\n```', 7);
    expect(exitCodeBlockOnEmptyFinalLine(nonEmpty)).toBe(false);

    const unfinished = createView('```\ncode\n', 8);
    expect(exitCodeBlockOnEmptyFinalLine(unfinished)).toBe(false);
  });

  it('respects read-only mode for every code command', () => {
    const source = '```\n\n```';
    const view = createView(source, 4, 4, true);
    for (const command of [insertCodeBlockTab]) expect(command(view)).toBe(false);
    expect(pasteCodeBlockText(view, 'new')).toBe(false);
    toggleCodeBlock(view);
    expect(view.state.doc.toString()).toBe(source);
  });
});
