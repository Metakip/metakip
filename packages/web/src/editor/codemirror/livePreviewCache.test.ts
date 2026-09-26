import { Decoration } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { trimLivePreviewCache } from './livePreviewCache';

describe('Live Preview cache', () => {
  it('bounds a cache of visited regions while preserving the current viewport', () => {
    const ranges = Array.from({ length: 20_000 }, (_, index) =>
      Decoration.mark({ class: 'cm-md-tag' }).range(index * 6, index * 6 + 1),
    );
    const decorations = Decoration.set(ranges, true);
    const visible = { from: 60_000, to: 61_000 };
    const trimmed = trimLivePreviewCache(decorations, 120_000, visible, () => null);
    expect(trimmed.size).toBeLessThanOrEqual(8_000);
    let visibleCount = 0;
    trimmed.between(visible.from, visible.to, () => {
      visibleCount += 1;
    });
    expect(visibleCount).toBeGreaterThan(100);
    expect(trimLivePreviewCache(trimmed, 120_000, visible, () => null)).toBe(trimmed);
  });

  it('does not separate a display-math widget from its hidden source', () => {
    const ranges = Array.from({ length: 20_000 }, (_, index) =>
      Decoration.line({ class: 'cm-md-math-hidden-line' }).range(index * 6),
    );
    const decorations = Decoration.set(ranges, true);
    const trimmed = trimLivePreviewCache(
      decorations,
      120_000,
      { from: 65_000, to: 65_100 },
      (position) =>
        position >= 50_000 && position <= 55_000 ? { from: 50_000, to: 55_000 } : null,
    );
    let retained = 0;
    trimmed.between(50_000, 50_100, () => {
      retained += 1;
    });
    expect(retained).toBeGreaterThan(0);
  });
});
