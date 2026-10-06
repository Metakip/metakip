import { describe, expect, it } from 'vitest';
import {
  COMMENT_ANCHOR_TEXT_MAX_LENGTH,
  commentAnchorSchema,
  pageCommentRequestSchema,
} from './comments';

describe('comment schemas', () => {
  it('preserves exact selected-text whitespace for inline anchors', () => {
    expect(
      commentAnchorSchema.parse({ quote: ' selected text ', prefix: 'before', suffix: 'after' }),
    ).toEqual({ quote: ' selected text ', prefix: 'before', suffix: 'after' });
  });

  it('rejects an empty quote and overlong comments', () => {
    expect(commentAnchorSchema.safeParse({ quote: '   ' }).success).toBe(false);
    expect(pageCommentRequestSchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false);
    expect(pageCommentRequestSchema.safeParse({ body: 'A comment' }).success).toBe(false);
    expect(
      commentAnchorSchema.safeParse({ quote: 'x'.repeat(COMMENT_ANCHOR_TEXT_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it('supports selecting all page text as a comment anchor', () => {
    expect(
      pageCommentRequestSchema.safeParse({
        body: 'A page-wide comment',
        anchor: { quote: 'x'.repeat(10_001) },
      }).success,
    ).toBe(true);
  });
});
