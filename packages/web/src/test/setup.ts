import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// --- Browser API mocks (not available in jsdom) ---

beforeAll(() => {
  // Mock scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = vi.fn();

  // Mock scrollTo
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

  // Mock matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock ResizeObserver
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

  // Mock PointerEvent (critical for Mantine/Radix components)
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;

  // Mock hasPointerCapture / releasePointerCapture
  window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();

  // Mock getComputedStyle for consistent results
  const originalGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = (elt: Element, pseudoElt?: string | null) => {
    const style = originalGetComputedStyle(elt, pseudoElt);
    return style;
  };

  // Mock DOMRect
  window.DOMRect = {
    fromRect: (rect?: DOMRectInit) => {
      const r = rect as DOMRectInit & { top?: number; left?: number };
      return {
        top: r?.top ?? 0,
        left: r?.left ?? 0,
        right: (r?.left ?? 0) + (r?.width ?? 0),
        bottom: (r?.top ?? 0) + (r?.height ?? 0),
        width: r?.width ?? 0,
        height: r?.height ?? 0,
        x: r?.left ?? 0,
        y: r?.top ?? 0,
        toJSON() {
          return JSON.stringify(this);
        },
      };
    },
  } as unknown as typeof DOMRect;

  // CodeMirror measures text ranges during animation-frame layout passes.
  window.Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  window.Range.prototype.getBoundingClientRect = vi.fn(() => DOMRect.fromRect());

  // Mock navigator.clipboard (configurable so @testing-library/user-event can replace it)
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(''),
    },
    writable: true,
    configurable: true,
  });

  // Mock localStorage (Node 22+ provides a broken localStorage in jsdom)
  Object.defineProperty(window, 'localStorage', {
    value: {
      _store: {} as Record<string, string>,
      getItem(key: string) {
        return this._store[key] ?? null;
      },
      setItem(key: string, value: string) {
        this._store[key] = value;
      },
      removeItem(key: string) {
        delete this._store[key];
      },
      clear() {
        this._store = {};
      },
      get length() {
        return Object.keys(this._store).length;
      },
      key(index: number) {
        return Object.keys(this._store)[index] ?? null;
      },
    },
    writable: true,
    configurable: true,
  });

  // Mock requestAnimationFrame / cancelAnimationFrame
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
    (cb: FrameRequestCallback): number => {
      return setTimeout(() => cb(Date.now()), 0) as unknown as number;
    },
  );
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    clearTimeout(id);
  });
});
