type CommentCardLayoutItem<T> = {
  value: T;
  anchorOffset: number;
  anchorTop: number;
  height: number;
};

export function layoutCommentCards<T>(
  items: readonly CommentCardLayoutItem<T>[],
  gap = 12,
  fallbackHeight = 84,
): { value: T; top: number }[] {
  const documentOrder = [...items].sort((left, right) => left.anchorOffset - right.anchorOffset);
  let previousBottom = Number.NEGATIVE_INFINITY;

  return documentOrder.map((item) => {
    const top = Math.max(item.anchorTop, previousBottom + gap);
    previousBottom = top + (item.height > 0 ? item.height : fallbackHeight);
    return { value: item.value, top };
  });
}
