import { describe, expect, it } from 'vitest';
import { layoutCommentCards } from './commentCardLayout';

describe('layoutCommentCards', () => {
  it('keeps card spacing proportional to the anchors when cards do not collide', () => {
    const layout = layoutCommentCards([
      { value: 'first', anchorOffset: 10, anchorTop: 100, height: 80 },
      { value: 'second', anchorOffset: 20, anchorTop: 310, height: 80 },
      { value: 'third', anchorOffset: 30, anchorTop: 540, height: 80 },
    ]);

    expect(layout).toEqual([
      { value: 'first', top: 100 },
      { value: 'second', top: 310 },
      { value: 'third', top: 540 },
    ]);
  });

  it('orders cards by their anchor position and only pushes cards to prevent overlap', () => {
    const layout = layoutCommentCards([
      { value: 'later anchor', anchorOffset: 20, anchorTop: 120, height: 80 },
      { value: 'earlier anchor', anchorOffset: 10, anchorTop: 120, height: 80 },
      { value: 'distant anchor', anchorOffset: 30, anchorTop: 300, height: 80 },
    ]);

    expect(layout).toEqual([
      { value: 'earlier anchor', top: 120 },
      { value: 'later anchor', top: 212 },
      { value: 'distant anchor', top: 304 },
    ]);
  });
});
