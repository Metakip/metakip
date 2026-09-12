import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFloatingToolbar } from './useFloatingToolbar';

function getSelection(): Selection {
  const selection = window.getSelection();
  if (!selection) throw new Error('Expected document selection support');
  return selection;
}

function selectText(element: HTMLElement): Range {
  const text = document.createTextNode('Selected text');
  element.append(text);

  const range = document.createRange();
  range.selectNodeContents(text);

  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  return range;
}

function notifySelectionChange() {
  document.dispatchEvent(new Event('selectionchange'));
  vi.advanceTimersByTime(100);
}

describe('useFloatingToolbar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    getSelection().removeAllRanges();
    document.querySelectorAll('[data-floating-toolbar-test]').forEach((element) => {
      element.remove();
    });
    vi.useRealTimers();
  });

  it('clones the editor selection and clears it when the selection collapses', () => {
    const editor = document.createElement('div');
    editor.className = 'codemirror-editor';
    editor.dataset.floatingToolbarTest = '';
    document.body.append(editor);
    const range = selectText(editor);
    const { result } = renderHook(() => useFloatingToolbar());

    act(() => {
      notifySelectionChange();
    });

    expect(result.current.visible).toBe(true);
    expect(result.current.position).not.toBe(range);
    expect(result.current.position?.commonAncestorContainer).toBe(range.commonAncestorContainer);

    act(() => {
      getSelection().removeAllRanges();
      notifySelectionChange();
    });

    expect(result.current).toMatchObject({ visible: false, position: null });
  });

  it('clears the stored range when selection moves outside the editor', () => {
    const editor = document.createElement('div');
    editor.className = 'codemirror-editor';
    editor.dataset.floatingToolbarTest = '';
    const outside = document.createElement('div');
    document.body.append(editor, outside);
    selectText(editor);
    const { result } = renderHook(() => useFloatingToolbar());

    act(() => {
      notifySelectionChange();
    });

    expect(result.current.visible).toBe(true);
    expect(result.current.position).not.toBeNull();

    act(() => {
      selectText(outside);
      notifySelectionChange();
    });

    expect(result.current).toMatchObject({ visible: false, position: null });
  });
});
