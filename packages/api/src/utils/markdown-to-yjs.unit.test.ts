import {
  bindWikiLinkTargets,
  bindWikiLinkTargetsInDocument,
  createEmptyYjsDoc,
  createYjsDocWithTitle,
  extractTitleFromYjs,
  markdownToYjsState,
  stripLeadingH1,
} from '@markdawn/shared/markdown-yjs';
import { yDocToMarkdown } from '@markdawn/shared/yjs-helpers';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

function content(update: Uint8Array): string {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, update);
    return document.getText('content').toString();
  } finally {
    document.destroy();
  }
}

describe('canonical Markdown Yjs documents', () => {
  it('stores Markdown losslessly in Y.Text', () => {
    const markdown = [
      '# Heading',
      '',
      '**bold** *italic* ~~strike~~ `code` $x=1$',
      '',
      '- [x] Task',
      '',
      '| A | B |',
      '| --- | ---: |',
      '| 1 | 2 |',
      '',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n');
    const update = markdownToYjsState(markdown);
    expect(content(update)).toBe(markdown);
    expect(yDocToMarkdown(update)).toBe(markdown);
  });

  it('normalizes collaborative line endings to LF', () => {
    expect(content(markdownToYjsState('one\r\ntwo\rthree'))).toBe('one\ntwo\nthree');
  });

  it('keeps the title independent from body Markdown', () => {
    const update = createYjsDocWithTitle('Page title', '# Authored heading');
    expect(extractTitleFromYjs(update)).toBe('Page title');
    expect(content(update)).toBe('# Authored heading');
  });

  it('creates an explicit empty content field', () => {
    const update = createEmptyYjsDoc('Empty page');
    const document = new Y.Doc();
    Y.applyUpdate(document, update);
    expect(document.share.has('content')).toBe(true);
    expect(document.getText('content').toString()).toBe('');
    document.destroy();
  });

  it('binds resolvable wiki links to stable UUID syntax', () => {
    const targetId = '11111111-1111-4111-8111-111111111111';
    const update = bindWikiLinkTargets(
      markdownToYjsState('See [[/Roadmap.md#Plan]] and [[Roadmap|Project plan]]'),
      new Map([['roadmap', targetId]]),
    );
    expect(content(update)).toBe(`See [[id:${targetId}#Plan]] and [[id:${targetId}|Project plan]]`);
  });

  it('does not rewrite wiki-like text in inline or fenced code', () => {
    const targetId = '11111111-1111-4111-8111-111111111111';
    const update = bindWikiLinkTargets(
      markdownToYjsState('`[[Roadmap]]`\n\n```\n[[Roadmap]]\n```\n\n[[Roadmap]]'),
      new Map([['roadmap', targetId]]),
    );
    expect(content(update)).toBe(
      `\`[[Roadmap]]\`\n\n\`\`\`\n[[Roadmap]]\n\`\`\`\n\n[[id:${targetId}]]`,
    );
  });

  it('preserves explicit aliases', () => {
    const targetId = '11111111-1111-4111-8111-111111111111';
    expect(
      content(
        bindWikiLinkTargets(
          markdownToYjsState('[[Roadmap|Roadmap]]'),
          new Map([['roadmap', targetId]]),
        ),
      ),
    ).toBe(`[[id:${targetId}|Roadmap]]`);
  });

  it('binds only the affected text range in an active document', () => {
    const targetId = '11111111-1111-4111-8111-111111111111';
    const document = new Y.Doc();
    Y.applyUpdate(document, createYjsDocWithTitle('Page', 'Unchanged [[Roadmap]] suffix'));
    const contentText = document.getText('content');
    const deltas: Array<Y.YTextEvent['delta']> = [];
    contentText.observe((event) => deltas.push(event.delta));

    bindWikiLinkTargetsInDocument(document, new Map([['roadmap', targetId]]));

    expect(contentText.toString()).toBe(`Unchanged [[id:${targetId}]] suffix`);
    expect(deltas[0]?.[0]).toEqual({ retain: 10 });
    document.destroy();
  });

  it('handles empty, unicode, and null-containing Markdown', () => {
    expect(content(markdownToYjsState(''))).toBe('');
    expect(content(markdownToYjsState('# 你好'))).toBe('# 你好');
    expect(content(markdownToYjsState('hello\0world'))).toBe('hello\0world');
  });
});

describe('stripLeadingH1', () => {
  it('strips only a matching leading title', () => {
    expect(stripLeadingH1('# Title\nBody', 'Title')).toBe('Body');
    expect(stripLeadingH1('# Other\nBody', 'Title')).toBe('# Other\nBody');
  });
});
