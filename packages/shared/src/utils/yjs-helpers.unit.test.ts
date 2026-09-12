import { describe, expect, it } from 'vitest';
import { markdownToYjsState } from './markdownToYjs';
import {
  extractConnectionsFromYDoc,
  extractWikiLinkTargetIds,
  yDocToMarkdown,
} from './yjs-helpers';

describe('extractConnectionsFromYDoc', () => {
  it('extracts page and tag connections from canonical content', () => {
    const update = markdownToYjsState(
      'See [[id:11111111-1111-1111-1111-111111111111|Roadmap]] for #Project',
    );

    expect(extractConnectionsFromYDoc(update)).toEqual([
      {
        targetType: 'page',
        targetId: '11111111-1111-1111-1111-111111111111',
        targetSlug: 'id:11111111-1111-1111-1111-111111111111',
        targetLabel: 'Roadmap',
        connectionType: 'wikilink',
        linkText: 'Roadmap',
        linkContext: 'See Roadmap for #Project',
      },
      {
        targetType: 'tag',
        targetSlug: '#project',
        targetLabel: '#project',
        connectionType: 'tag',
        linkText: '#project',
        linkContext: 'See Roadmap for #Project',
      },
    ]);
  });
});

describe('wiki-link target IDs', () => {
  it('extracts stable target IDs from canonical content', () => {
    const targetId = '11111111-1111-1111-1111-111111111111';
    expect(
      extractWikiLinkTargetIds(markdownToYjsState(`[[id:${targetId}|Authored alias]]`)),
    ).toEqual([targetId]);
  });

  it('exports canonical IDs through requester-scoped current titles', () => {
    const targetId = '11111111-1111-1111-1111-111111111111';
    const update = markdownToYjsState(`[[id:${targetId}#Plan|Authored alias]]`);
    expect(
      yDocToMarkdown(update, {
        resolveWikiLinkTarget: () => ({ title: 'Renamed page' }),
      }),
    ).toBe('[[Renamed page#Plan|Authored alias]]');
    expect(yDocToMarkdown(update)).toBe('Restricted page');
  });

  it('does not index wiki links or tags inside code', () => {
    const targetId = '11111111-1111-1111-1111-111111111111';
    const update = markdownToYjsState(
      `\`[[id:${targetId}]] #hidden\`\n\n\`\`\`\n[[id:${targetId}]] #hidden\n\`\`\`\n\n[[id:${targetId}]] #visible`,
    );
    const connections = extractConnectionsFromYDoc(update);
    expect(connections.filter((connection) => connection.targetType === 'page')).toHaveLength(1);
    expect(connections.filter((connection) => connection.targetType === 'tag')).toEqual([
      expect.objectContaining({ targetSlug: '#visible' }),
    ]);
  });

  it('does not index embed syntax as a wiki link', () => {
    const targetId = '11111111-1111-1111-1111-111111111111';
    const connections = extractConnectionsFromYDoc(markdownToYjsState(`![[id:${targetId}]]`));
    expect(connections.filter((connection) => connection.targetType === 'page')).toEqual([]);
  });
});
