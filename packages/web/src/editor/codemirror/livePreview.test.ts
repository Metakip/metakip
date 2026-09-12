import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { livePreview } from './livePreview';
import { mathMarkdownExtension, wikiLinkMarkdownExtension } from './markdownSyntax';

function createView(doc: string): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: [GFM, wikiLinkMarkdownExtension, mathMarkdownExtension] }),
        livePreview(),
      ],
    }),
  });
}

describe('CodeMirror Live Preview', () => {
  it('reveals both code fences anywhere inside the block and compacts them after leaving', () => {
    const source = 'Before\n```\ncode\n```\nAfter';
    const view = createView(source);
    expect(view.dom.querySelectorAll('.cm-md-code-fence-compact')).toHaveLength(2);
    view.dispatch({ selection: { anchor: source.indexOf('code') + 2 } });
    expect(view.dom.querySelectorAll('.cm-md-code-fence-compact')).toHaveLength(0);
    expect(view.dom.querySelector('.cm-md-code-block-first')?.textContent).toContain('```');
    expect(view.dom.querySelector('.cm-md-code-block-last')?.textContent).toContain('```');
    view.dispatch({ selection: { anchor: source.indexOf('```') + 3 } });
    expect(
      view.dom
        .querySelector('.cm-md-code-block-first')
        ?.classList.contains('cm-md-code-fence-compact'),
    ).toBe(false);
    expect(view.dom.querySelector('.cm-md-code-block-first')?.textContent).toContain('```');
    view.dispatch({ selection: { anchor: source.lastIndexOf('```') + 3 } });
    expect(view.dom.querySelectorAll('.cm-md-code-fence-compact')).toHaveLength(0);
    view.dispatch({ selection: { anchor: source.indexOf('After') } });
    expect(view.dom.querySelectorAll('.cm-md-code-fence-compact')).toHaveLength(2);
    expect(view.dom.textContent).not.toContain('```');
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });

  it('keeps language metadata visible and never compacts an unclosed block’s last code line', () => {
    const view = createView('Before\n```js\ncode');
    expect(view.dom.querySelector('.cm-md-code-block-first')?.textContent).toContain('js');
    expect(view.dom.querySelectorAll('.cm-md-code-fence-compact')).toHaveLength(0);
    view.destroy();
  });

  it('hides heading marker whitespace without changing the source', () => {
    const source = 'Before\n\n##   Aligned heading\n\nAfter';
    const view = createView(source);
    expect(view.dom.querySelector('.cm-md-heading')?.textContent).toBe('Aligned heading');
    expect(view.state.doc.toString()).toBe(source);

    view.dispatch({ selection: { anchor: source.indexOf('Aligned') } });
    expect(view.dom.querySelector('.cm-md-heading')?.textContent).toBe('##   Aligned heading');
    view.destroy();
  });

  it('uses consistent list indents and hides structural whitespace', () => {
    const source = 'Before\n\n- Parent\n  - Nested\n- [x] Done\n\n1. Ordered';
    const view = createView(source);
    const items = view.dom.querySelectorAll<HTMLElement>('.cm-md-list-item');
    expect([...items].map((item) => item.style.getPropertyValue('--cm-md-list-indent'))).toEqual([
      '1.5rem',
      '3rem',
      '1.5rem',
      '1.5rem',
    ]);
    expect([...items].map((item) => item.textContent)).toEqual([
      '•Parent',
      '•Nested',
      'Done',
      '1.Ordered',
    ]);
    expect(view.dom.querySelector('.cm-md-task-checked')?.textContent).toBe('Done');
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });

  it('hides inactive strong markers and reveals the active construct', () => {
    const view = createView('Before **bold** after');
    expect(view.dom.textContent).toContain('Before bold after');
    expect(view.dom.textContent).not.toContain('**');

    view.dispatch({ selection: { anchor: 10 } });

    expect(view.dom.textContent).toContain('**bold**');
    view.destroy();
  });

  it('renders inline math with KaTeX until it is selected', () => {
    const view = createView('Value: $x^2$');
    expect(view.dom.querySelector('.katex')).not.toBeNull();

    view.dispatch({ selection: { anchor: 9 } });

    expect(view.dom.textContent).toContain('$x^2$');
    view.destroy();
  });

  it('renders block math without interpreting math fences inside code blocks', () => {
    const view = createView('$$\nx^2\n$$\n\n```\n$$\nnot math\n$$\n```');
    view.dispatch({ selection: { anchor: 11 } });

    expect(view.dom.querySelectorAll('.cm-md-math-block')).toHaveLength(1);
    expect(view.dom.querySelector('.cm-md-code-block')).not.toBeNull();
    view.destroy();
  });

  it('keeps nested formatting while hiding inactive link destinations', () => {
    const view = createView('Before [**formatted**](https://example.com)');
    expect(view.dom.textContent).toContain('Before formatted');
    expect(view.dom.textContent).not.toContain('https://example.com');
    expect(view.dom.querySelector('.cm-md-strong')).not.toBeNull();
    expect(view.dom.querySelector('a[href="https://example.com"]')).not.toBeNull();
    view.destroy();
  });

  it('never places executable collaborative links in the DOM', () => {
    const view = createView('Before [unsafe](javascript:alert(1))');
    expect(view.dom.querySelector('a')).toBeNull();
    expect(view.dom.querySelector('.cm-md-unsafe-link')).not.toBeNull();
    view.destroy();
  });

  it('uses a native block wrapper for editable GFM tables', () => {
    const view = createView('| A | B |\n| --- | :---: |\n| 1 | 2 |');
    expect(view.dom.querySelector('.cm-md-table')).not.toBeNull();
    expect(view.dom.querySelectorAll('.cm-md-table-cell')).toHaveLength(4);
    expect(view.dom.querySelectorAll('.cm-md-align-center')).toHaveLength(2);
    view.destroy();
  });

  it('keeps empty cell whitespace and populated cell padding in editable marks', () => {
    const view = createView('| A | B |\n| --- | --- |\n|  | Right |');
    const cells = view.dom.querySelectorAll('.cm-md-table-row .cm-md-table-cell');
    expect(cells).toHaveLength(2);
    expect(cells[0]?.textContent).toBe('  ');
    expect(cells[1]?.textContent).toBe(' Right ');
    for (const cell of cells) expect(cell).not.toHaveAttribute('contenteditable', 'false');
    view.destroy();
  });

  it.each([
    '| A | B | C |\n| --- | :---: | ---: |\n| Left | | Right |',
    '|A|B|C|\n|---|:---:|---:|\n|Left||Right|',
  ])('keeps empty table columns and removes whitespace outside cells: %s', (source) => {
    const view = createView(source);
    const row = view.dom.querySelector('.cm-md-table-row');
    const cells = row?.querySelectorAll('.cm-md-table-cell');
    expect(cells).toHaveLength(3);
    expect(cells?.[1]).toHaveClass('cm-md-table-empty-cell', 'cm-md-align-center');
    expect(cells?.[2]).toHaveClass('cm-md-align-right');
    expect(row?.textContent?.replace(/\s/g, '')).toBe('LeftRight');
    expect(cells?.[1]?.textContent?.trim()).toBe('');
    expect(view.dom.querySelector('.cm-md-table-header')?.textContent?.replace(/\s/g, '')).toBe(
      'ABC',
    );
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });

  it('recognizes wiki links without interpreting fenced code', () => {
    const view = createView('Before [[Page]]\n\n```\n[[Not a link]]\n```');
    expect(view.dom.querySelectorAll('.cm-md-wiki-link')).toHaveLength(1);
    view.destroy();
  });

  it('does not render an empty wiki-link target', () => {
    const view = createView('Before [[   ]] after');
    expect(view.dom.querySelector('.cm-md-wiki-link')).toBeNull();
    expect(view.dom.textContent).toContain('[[   ]]');
    view.destroy();
  });

  it('treats embed syntax and escaped brackets as plain Markdown', () => {
    const view = createView('![[Embedded]] and \\[[Escaped]]');
    expect(view.dom.querySelector('.cm-md-wiki-link')).toBeNull();
    expect(view.dom.textContent).toContain('![[Embedded]]');
    expect(view.dom.textContent).toContain('[[Escaped]]');
    view.destroy();
  });
});

describe('Y.Text CodeMirror binding', () => {
  it('synchronizes local and remote granular edits', () => {
    const document = new Y.Doc();
    const text = document.getText('content');
    text.insert(0, 'One');
    const view = new EditorView({
      state: EditorState.create({ doc: text.toString(), extensions: yCollab(text, null) }),
    });

    view.dispatch({ changes: { from: 3, insert: ' two' } });
    expect(text.toString()).toBe('One two');

    text.insert(0, 'Remote: ');
    expect(view.state.doc.toString()).toBe('Remote: One two');
    view.destroy();
    document.destroy();
  });
});
