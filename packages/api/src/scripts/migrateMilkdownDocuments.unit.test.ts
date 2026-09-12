import { MAX_YDOC_BYTES } from '@markdawn/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { convertEditorPage, legacyXmlYDocToMarkdown } from './migrateMilkdownDocuments';

function element(name: string, children: Array<Y.XmlElement | Y.XmlText> = []): Y.XmlElement {
  const node = new Y.XmlElement(name);
  if (children.length > 0) node.push(children);
  return node;
}

function elementWithAttributes(
  name: string,
  attributes: Record<string, string>,
  children: Array<Y.XmlElement | Y.XmlText> = [],
): Y.XmlElement {
  const node = element(name, children);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function legacyUpdate(...children: Y.XmlElement[]): Uint8Array {
  const document = new Y.Doc();
  document.getXmlFragment('prosemirror').push(children);
  return Y.encodeStateAsUpdate(document);
}

function formattedLegacyUpdate(
  value: string,
  formats: Array<{ from: number; length: number; attributes: Record<string, boolean> }>,
): Uint8Array {
  const document = new Y.Doc();
  const text = new Y.XmlText(value);
  const paragraph = element('paragraph', [text]);
  document.getXmlFragment('prosemirror').push([paragraph]);
  for (const format of formats) text.format(format.from, format.length, format.attributes);
  return Y.encodeStateAsUpdate(document);
}

function inspectCanonicalDocument(state: Uint8Array): {
  content: string;
  hasContent: boolean;
  hasLegacyContent: boolean;
  title: string;
} {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, state);
    return {
      content: document.getText('content').toString(),
      hasContent: document.share.has('content'),
      hasLegacyContent: document.share.has('prosemirror'),
      title: document.getText('title').toString(),
    };
  } finally {
    document.destroy();
  }
}

describe('Milkdown document migration', () => {
  it('preserves separate paragraphs in a loose list item', () => {
    const item = element('list_item', [
      element('paragraph', [new Y.XmlText('First paragraph')]),
      element('paragraph', [new Y.XmlText('Second paragraph')]),
    ]);

    expect(legacyXmlYDocToMarkdown(legacyUpdate(element('bullet_list', [item])))).toBe(
      '- First paragraph\n\n  Second paragraph\n',
    );
  });

  it('escapes literal table separators inside cells', () => {
    const header = element('table_header_row', [
      element('table_header', [element('paragraph', [new Y.XmlText('Expression')])]),
      element('table_header', [element('paragraph', [new Y.XmlText('Result')])]),
    ]);
    const row = element('table_row', [
      element('table_cell', [element('paragraph', [new Y.XmlText('a | b')])]),
      element('table_cell', [element('paragraph', [new Y.XmlText('true')])]),
    ]);

    expect(legacyXmlYDocToMarkdown(legacyUpdate(element('table', [header, row])))).toBe(
      '| Expression | Result |\n| ---------- | ------ |\n| a \\| b     | true   |\n',
    );
  });

  it('uses a fence longer than backtick runs in code', () => {
    const code = element('code_block', [new Y.XmlText('before\n```\nafter')]);
    code.setAttribute('language', 'md');

    expect(legacyXmlYDocToMarkdown(legacyUpdate(code))).toBe('````md\nbefore\n```\nafter\n````\n');
  });

  it('preserves a hard break as an explicit Markdown break', () => {
    const paragraph = element('paragraph', [
      new Y.XmlText('First line'),
      element('hardbreak'),
      new Y.XmlText('Second line'),
    ]);

    expect(legacyXmlYDocToMarkdown(legacyUpdate(paragraph))).toBe('First line\\\nSecond line\n');
  });

  it('escapes Markdown punctuation that was literal legacy paragraph text', () => {
    const paragraph = element('paragraph', [
      new Y.XmlText('# literal heading\n*literal emphasis*\n[[literal wiki link]]'),
    ]);

    expect(legacyXmlYDocToMarkdown(legacyUpdate(paragraph))).toBe(
      '\\# literal heading\n\\*literal emphasis\\*\n\\[\\[literal wiki link]]\n',
    );
  });

  it('chooses a safe delimiter for backticks inside inline code', () => {
    const value = 'a`b';
    const update = formattedLegacyUpdate(value, [
      { from: 0, length: value.length, attributes: { inlineCode: true } },
    ]);

    expect(legacyXmlYDocToMarkdown(update)).toBe('``a`b``\n');
  });

  it('preserves a mark that continues after an outer mark closes', () => {
    const update = formattedLegacyUpdate('ab', [
      { from: 0, length: 2, attributes: { strike_through: true } },
      { from: 0, length: 1, attributes: { strong: true } },
    ]);

    expect(legacyXmlYDocToMarkdown(update)).toBe('**~~a~~**~~b~~\n');
  });

  it('preserves headings, quotes, dividers, and task lists', () => {
    const task = elementWithAttributes('list_item', { checked: 'true' }, [
      element('paragraph', [new Y.XmlText('Finished')]),
    ]);
    const update = legacyUpdate(
      elementWithAttributes('heading', { level: '2' }, [new Y.XmlText('Heading')]),
      element('blockquote', [element('paragraph', [new Y.XmlText('Quoted')])]),
      element('hr'),
      element('bullet_list', [task]),
    );

    expect(legacyXmlYDocToMarkdown(update)).toBe(
      '## Heading\n\n> Quoted\n\n---\n\n- [x] Finished\n',
    );
  });

  it('preserves legacy inline nodes and their attributes', () => {
    const update = legacyUpdate(
      element('paragraph', [
        elementWithAttributes('image', {
          src: 'https://example.com/image.png',
          alt: 'Example',
          title: 'Caption',
        }),
        new Y.XmlText(' '),
        elementWithAttributes('wikiLink', {
          targetId: '123E4567-E89B-12D3-A456-426614174000',
          heading: 'Details',
          label: 'Read more',
        }),
        new Y.XmlText(' '),
        elementWithAttributes('tag', { name: 'release' }),
        new Y.XmlText(' '),
        elementWithAttributes('math_inline', { value: 'x^2' }),
      ]),
    );

    expect(legacyXmlYDocToMarkdown(update)).toBe(
      '![Example](https://example.com/image.png "Caption") [[id:123e4567-e89b-12d3-a456-426614174000#Details|Read more]] #release $x^2$\n',
    );
  });

  it('preserves callout type, title, and body paragraphs', () => {
    const callout = elementWithAttributes('callout', { type: 'warning', title: 'Careful' }, [
      element('paragraph', [new Y.XmlText('First')]),
      element('paragraph', [new Y.XmlText('Second')]),
    ]);

    expect(legacyXmlYDocToMarkdown(legacyUpdate(callout))).toBe(
      '> [!WARNING Careful]\n>\n> First\n>\n> Second\n',
    );
  });
});

describe('editor page conversion', () => {
  it('creates a canonical empty document when stored content is missing', () => {
    const converted = convertEditorPage({ id: 'empty-page', title: 'Empty page', ydoc: null });

    expect(inspectCanonicalDocument(converted.state)).toEqual({
      content: '',
      hasContent: true,
      hasLegacyContent: false,
      title: 'Empty page',
    });
  });

  it('converts a legacy document and uses the database title as a fallback', () => {
    const state = legacyUpdate(element('paragraph', [new Y.XmlText('Legacy body')]));
    const converted = convertEditorPage({
      id: 'legacy-page',
      title: 'Database title',
      ydoc: Buffer.from(state),
    });

    expect(inspectCanonicalDocument(converted.state)).toEqual({
      content: 'Legacy body\n',
      hasContent: true,
      hasLegacyContent: false,
      title: 'Database title',
    });
  });

  it('leaves an already canonical document byte-for-byte unchanged', () => {
    const document = new Y.Doc();
    document.getText('title').insert(0, 'Canonical page');
    document.getText('content').insert(0, 'Canonical body');
    const state = Y.encodeStateAsUpdate(document);
    document.destroy();

    const converted = convertEditorPage({
      id: 'canonical-page',
      title: 'Canonical page',
      ydoc: Buffer.from(state),
    });

    expect(Buffer.from(converted.state).equals(Buffer.from(state))).toBe(true);
  });

  it('normalizes legacy line endings in canonical content', () => {
    const document = new Y.Doc();
    document.getText('title').insert(0, 'Windows page');
    document.getText('content').insert(0, 'First\r\nSecond\rThird');
    const state = Y.encodeStateAsUpdate(document);
    document.destroy();

    const converted = convertEditorPage({
      id: 'windows-page',
      title: 'Windows page',
      ydoc: Buffer.from(state),
    });

    expect(inspectCanonicalDocument(converted.state).content).toBe('First\nSecond\nThird');
  });

  it('rejects documents containing both editor formats', () => {
    const document = new Y.Doc();
    document.getText('content').insert(0, 'Canonical body');
    document.getXmlFragment('prosemirror').push([element('paragraph')]);
    const state = Y.encodeStateAsUpdate(document);
    document.destroy();

    expect(() =>
      convertEditorPage({
        id: 'mixed-page',
        title: 'Mixed page',
        ydoc: Buffer.from(state),
      }),
    ).toThrow('contains both canonical and legacy editor fields');
  });

  it('rejects an already canonical document above the storage limit', () => {
    const document = new Y.Doc();
    document.getText('content').insert(0, 'x'.repeat(MAX_YDOC_BYTES));
    const state = Y.encodeStateAsUpdate(document);
    document.destroy();

    expect(state.byteLength).toBeGreaterThan(MAX_YDOC_BYTES);
    expect(() =>
      convertEditorPage({
        id: 'oversized-page',
        title: 'Oversized page',
        ydoc: Buffer.from(state),
      }),
    ).toThrow('exceeds the collaborative document size limit');
  });

  it('is stable when converted content is passed through again', () => {
    const first = convertEditorPage({
      id: 'rerun-page',
      title: 'Rerun page',
      ydoc: Buffer.from(legacyUpdate(element('paragraph', [new Y.XmlText('Body')]))),
    });
    const second = convertEditorPage({
      id: 'rerun-page',
      title: 'Rerun page',
      ydoc: Buffer.from(first.state),
    });

    expect(Buffer.from(second.state).equals(Buffer.from(first.state))).toBe(true);
  });
});
