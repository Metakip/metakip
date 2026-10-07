import { describe, expect, it } from 'vitest';
import { anchorFromSelection, commentAnchorKey, findCommentAnchorRange } from './commentAnchors';

describe('anchorFromSelection', () => {
  it('supports selecting all page text for a page-wide comment', () => {
    const markdown = 'x'.repeat(10_001);
    expect(anchorFromSelection(markdown, 0, markdown.length)).toEqual({
      quote: markdown,
      prefix: '',
      suffix: '',
    });
  });
});

describe('findCommentAnchorRange', () => {
  it('finds a unique quote and returns its document range', () => {
    expect(
      findCommentAnchorRange('Intro text\nselected passage\nEnd', { quote: 'selected passage' }),
    ).toEqual({ from: 11, to: 27 });
  });

  it('uses context to disambiguate repeated quotes', () => {
    expect(
      findCommentAnchorRange('repeat here\nother\nrepeat here', {
        quote: 'repeat',
        prefix: 'repeat here\nother\n',
        suffix: ' here',
      }),
    ).toEqual({ from: 18, to: 24 });
  });

  it('does not return ambiguous matches', () => {
    expect(findCommentAnchorRange('repeat and repeat', { quote: 'repeat' })).toBeNull();
  });
});

describe('commentAnchorKey', () => {
  it('distinguishes identical quotes with different context', () => {
    expect(commentAnchorKey({ quote: 'same', prefix: 'before ', suffix: ' after' })).not.toBe(
      commentAnchorKey({ quote: 'same', prefix: 'other ', suffix: ' after' }),
    );
  });
});
