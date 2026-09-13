import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSidebarCollapsed } from './useSidebarCollapsed';

describe('useSidebarCollapsed', () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          store = {};
        },
        get length() {
          return Object.keys(store).length;
        },
        key: (index: number) => Object.keys(store)[index] ?? null,
      },
      writable: true,
    });
  });

  afterEach(() => {
    store = {};
  });

  it('defaults to false when nothing is stored', () => {
    const { result } = renderHook(() => useSidebarCollapsed());

    expect(result.current.collapsed).toBe(false);
  });

  it('reads stored collapsed state from localStorage', () => {
    store['metakip-sidebar-collapsed'] = 'true';
    const { result } = renderHook(() => useSidebarCollapsed());

    expect(result.current.collapsed).toBe(true);
  });

  it('persists collapsed state to localStorage on change', () => {
    const { result } = renderHook(() => useSidebarCollapsed());

    act(() => {
      result.current.setCollapsed(true);
    });

    expect(result.current.collapsed).toBe(true);
    expect(store['metakip-sidebar-collapsed']).toBe('true');
  });

  it('setCollapsed(false) updates state and localStorage', () => {
    store['metakip-sidebar-collapsed'] = 'true';
    const { result } = renderHook(() => useSidebarCollapsed());

    act(() => {
      result.current.setCollapsed(false);
    });

    expect(result.current.collapsed).toBe(false);
    expect(store['metakip-sidebar-collapsed']).toBe('false');
  });

  it('toggleCollapsed flips the collapsed state', () => {
    const { result } = renderHook(() => useSidebarCollapsed());

    expect(result.current.collapsed).toBe(false);

    act(() => {
      result.current.toggleCollapsed();
    });

    expect(result.current.collapsed).toBe(true);

    act(() => {
      result.current.toggleCollapsed();
    });

    expect(result.current.collapsed).toBe(false);
  });

  it('handles localStorage corruption gracefully', () => {
    const { result } = renderHook(() => useSidebarCollapsed());

    const brokenStorage = {
      getItem: () => {
        throw new Error('Quota exceeded');
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      get length() {
        return 0;
      },
      key: () => null,
    };
    Object.defineProperty(window, 'localStorage', {
      value: brokenStorage,
      writable: true,
    });

    act(() => {
      result.current.setCollapsed(true);
    });

    expect(result.current.collapsed).toBe(true);
  });
});
