import { describe, expect, it } from 'vitest';
import {
  buildWikiLinkResolution,
  normalizeWikiLinkLookupKey,
  parseWikiLinkTarget,
} from './wikiLink';

describe('normalizeWikiLinkLookupKey', () => {
  it.each([
    ['Roadmap', 'roadmap'],
    ['/Roadmap.md#Plan', 'roadmap'],
    ['./Folder/Roadmap.MD', 'folder/roadmap'],
    ['Folder\\Roadmap#Plan', 'folder/roadmap'],
    ['  Mixed Case  ', 'mixed case'],
  ])('normalizes %s consistently', (input, expected) => {
    expect(normalizeWikiLinkLookupKey(input)).toBe(expected);
  });
});

describe('buildWikiLinkResolution', () => {
  it('uses visible paths when duplicate titles are not unique', () => {
    const resolution = buildWikiLinkResolution([
      { pageId: 'one', title: 'Plan', pagePath: 'Alpha/Plan' },
      { pageId: 'two', title: 'Plan', pagePath: 'Beta/Plan' },
      { pageId: 'three', title: 'Unique', pagePath: 'Alpha/Unique' },
    ]);

    expect(resolution.pageLookup.has('plan')).toBe(false);
    expect(resolution.pageLookup.get('alpha/plan')).toBe('one');
    expect(resolution.targetMarkdownPaths.get('one')).toBe('Alpha/Plan');
    expect(resolution.targetMarkdownPaths.get('three')).toBe('Unique');
  });
});

describe('parseWikiLinkTarget', () => {
  it('parses page, heading, alias, and canonical target IDs', () => {
    expect(parseWikiLinkTarget('Roadmap#Plan|Project plan')).toEqual({
      authoredTarget: 'Roadmap#Plan',
      targetId: null,
      page: 'Roadmap',
      heading: 'Plan',
      alias: 'Project plan',
    });
    expect(parseWikiLinkTarget('id:123E4567-E89B-12D3-A456-426614174000')).toEqual(
      expect.objectContaining({
        targetId: '123e4567-e89b-12d3-a456-426614174000',
        page: 'id:123E4567-E89B-12D3-A456-426614174000',
      }),
    );
  });

  it('rejects empty targets and treats malformed IDs as authored paths', () => {
    expect(parseWikiLinkTarget('   ')).toBeNull();
    expect(parseWikiLinkTarget('id:not-a-uuid')).toEqual(
      expect.objectContaining({ targetId: null, page: 'id:not-a-uuid' }),
    );
  });
});
