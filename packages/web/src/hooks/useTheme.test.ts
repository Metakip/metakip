import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTheme } from './useTheme';

describe('useTheme', () => {
  let store: Record<string, string> = {};
  let themeColor: HTMLMetaElement;

  beforeEach(() => {
    store = {};
    themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    themeColor.content = '#ffffff';
    document.head.append(themeColor);
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
    themeColor.remove();
  });

  it('defaults to "system" theme when nothing is stored', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');
  });

  it('reads stored theme from localStorage', () => {
    store['metakip-theme'] = 'dark';
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
  });

  it('defaults to "system" for invalid stored values', () => {
    store['metakip-theme'] = 'invalid-value';
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');
  });

  it('setTheme updates both theme state and localStorage', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.theme).toBe('dark');
    expect(store['metakip-theme']).toBe('dark');
  });

  it('applies "dark" class to documentElement when theme is dark', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes "dark" class from documentElement when theme is light', () => {
    store['metakip-theme'] = 'dark';
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('light');
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('updates the browser theme color when the theme changes', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme('dark'));
    expect(themeColor.content).toBe('#09090b');

    act(() => result.current.setTheme('light'));
    expect(themeColor.content).toBe('#ffffff');
  });

  it('cycles through light -> dark -> system -> light', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');

    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');

    act(() => result.current.setTheme('dark'));
    expect(result.current.theme).toBe('dark');

    act(() => result.current.setTheme('system'));
    expect(result.current.theme).toBe('system');
  });

  it('isDark is true when theme is dark', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.isDark).toBe(true);
  });

  it('isDark is false when theme is light', () => {
    store['metakip-theme'] = 'dark';
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('light');
    });

    expect(result.current.isDark).toBe(false);
  });
});
