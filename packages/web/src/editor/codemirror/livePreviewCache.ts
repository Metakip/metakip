import type { DecorationSet } from '@codemirror/view';

// Enough nearby content to avoid repeatedly changing scroll measurements, but
// a fixed upper bound on the cached decorations after visiting a large page.
const MAX_CACHED_DECORATIONS = 16_000;
const CACHE_RADIUS = 100_000;

type SourceRange = { from: number; to: number };

export function trimLivePreviewCache(
  decorations: DecorationSet,
  documentLength: number,
  visible: SourceRange,
  previewBlockAt: (position: number) => SourceRange | null,
): DecorationSet {
  if (decorations.size <= MAX_CACHED_DECORATIONS) return decorations;
  let result = decorations;
  let radius = CACHE_RADIUS;
  do {
    let keepFrom = Math.max(0, visible.from - radius);
    let keepTo = Math.min(documentLength, visible.to + radius);
    // Don't keep only part of a rendered block and strand its hidden source.
    const firstBlock = previewBlockAt(keepFrom);
    const lastBlock = previewBlockAt(keepTo);
    if (firstBlock) keepFrom = Math.min(keepFrom, firstBlock.from);
    if (lastBlock) keepTo = Math.max(keepTo, lastBlock.to);
    result = result.update({ filter: (start, end) => end >= keepFrom && start <= keepTo });
    radius = Math.floor(radius / 2);
  } while (result.size > MAX_CACHED_DECORATIONS / 2 && radius > 0);
  return result;
}
