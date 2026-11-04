import { useCallback, useLayoutEffect, useState } from 'react';

const STORAGE_KEY_PREFIX = 'metakip-page-full-width:';

function getSavedFullWidth(pageId: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${pageId}`) === 'true';
  } catch {
    return false;
  }
}

function saveFullWidth(pageId: string, fullWidth: boolean): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${pageId}`, String(fullWidth));
  } catch {}
}

export function usePageFullWidth(pageId: string | undefined) {
  const [fullWidth, setFullWidth] = useState(() => (pageId ? getSavedFullWidth(pageId) : false));

  useLayoutEffect(() => {
    setFullWidth(pageId ? getSavedFullWidth(pageId) : false);
  }, [pageId]);

  const toggleFullWidth = useCallback(() => {
    if (!pageId) return;
    const nextValue = !fullWidth;
    setFullWidth(nextValue);
    saveFullWidth(pageId, nextValue);
  }, [fullWidth, pageId]);

  return { fullWidth, toggleFullWidth };
}
