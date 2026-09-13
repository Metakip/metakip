import { createYjsDocWithTitle } from '@metakip/shared/markdown-yjs';
import { replaceMarkdownBody } from '@metakip/shared/yjs-document-replacement';
import { yDocToMarkdown } from '@metakip/shared/yjs-helpers';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

describe('replaceMarkdownBody', () => {
  it('preserves unchanged text through a minimal Y.Text edit', () => {
    const document = new Y.Doc();
    Y.applyUpdate(
      document,
      createYjsDocWithTitle('Page title', '## Notes\n\nFirst paragraph.\n\nSecond paragraph.\n'),
    );
    const content = document.getText('content');
    const deltas: Array<Y.YTextEvent['delta']> = [];
    content.observe((event) => deltas.push(event.delta));

    replaceMarkdownBody(
      document,
      'Page title',
      '## Notes\n\nFirst paragraph.\n\nRevised paragraph.\n',
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.[0]).toEqual({ retain: 28 });
    expect(yDocToMarkdown(Y.encodeStateAsUpdate(document))).toBe(
      '## Notes\n\nFirst paragraph.\n\nRevised paragraph.\n',
    );
  });
});
