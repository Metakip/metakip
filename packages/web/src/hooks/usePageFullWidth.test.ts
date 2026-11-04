import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePageFullWidth } from './usePageFullWidth';

describe('usePageFullWidth', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('persists the preference per page and restores it on navigation', () => {
    const { result, rerender } = renderHook(({ pageId }) => usePageFullWidth(pageId), {
      initialProps: { pageId: 'page-one' as string | undefined },
    });

    expect(result.current.fullWidth).toBe(false);
    act(() => result.current.toggleFullWidth());
    expect(result.current.fullWidth).toBe(true);
    expect(localStorage.getItem('metakip-page-full-width:page-one')).toBe('true');

    rerender({ pageId: 'page-two' });
    expect(result.current.fullWidth).toBe(false);

    rerender({ pageId: 'page-one' });
    expect(result.current.fullWidth).toBe(true);
  });

  it('reloads a page preference when returning instead of using a stale visited-page value', () => {
    const { result, rerender } = renderHook(({ pageId }) => usePageFullWidth(pageId), {
      initialProps: { pageId: 'page-one' as string | undefined },
    });

    act(() => result.current.toggleFullWidth());
    rerender({ pageId: 'page-two' });
    localStorage.setItem('metakip-page-full-width:page-one', 'false');

    rerender({ pageId: 'page-one' });
    expect(result.current.fullWidth).toBe(false);
  });
});
