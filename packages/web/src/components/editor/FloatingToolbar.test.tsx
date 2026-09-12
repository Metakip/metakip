import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFloatingToolbar } from '../../hooks/useFloatingToolbar';
import type { FloatingToolbarProps } from './FloatingToolbar';

const floatingMocks = vi.hoisted(() => ({
  isPositioned: false,
  setFloating: vi.fn(),
  setPositionReference: vi.fn(),
}));

vi.mock('@floating-ui/react', () => ({
  autoUpdate: vi.fn(),
  flip: vi.fn(() => ({ name: 'flip' })),
  inline: vi.fn(() => ({ name: 'inline' })),
  offset: vi.fn(() => ({ name: 'offset' })),
  shift: vi.fn(() => ({ name: 'shift' })),
  useFloating: vi.fn(() => ({
    floatingStyles: { position: 'fixed' },
    isPositioned: floatingMocks.isPositioned,
    refs: {
      setFloating: floatingMocks.setFloating,
      setPositionReference: floatingMocks.setPositionReference,
    },
  })),
}));

import { FloatingToolbar } from './FloatingToolbar';

function createPosition(): Range {
  const contextElement = document.createElement('div');
  return {
    commonAncestorContainer: contextElement,
    getBoundingClientRect: vi.fn(),
    getClientRects: vi.fn(),
  } as unknown as Range;
}

function createProps(overrides: Partial<FloatingToolbarProps> = {}): FloatingToolbarProps {
  return {
    isInTableActive: false,
    onAddColAfter: vi.fn(),
    onAddColBefore: vi.fn(),
    onAddRowAfter: vi.fn(),
    onAddRowBefore: vi.fn(),
    onBlockquote: vi.fn(),
    onBold: vi.fn(),
    onBulletList: vi.fn(),
    onCode: vi.fn(),
    onDeleteCol: vi.fn(),
    onDeleteRow: vi.fn(),
    onDeleteTable: vi.fn(),
    onH1: vi.fn(),
    onH2: vi.fn(),
    onH3: vi.fn(),
    onH4: vi.fn(),
    onH5: vi.fn(),
    onH6: vi.fn(),
    onInsertTable: vi.fn(),
    onItalic: vi.fn(),
    onLink: vi.fn(),
    onInteractionStart: vi.fn(),
    onOrderedList: vi.fn(),
    onStrike: vi.fn(),
    onTaskList: vi.fn(),
    position: createPosition(),
    visible: true,
    ...overrides,
  };
}

function getSelection(): Selection {
  const selection = window.getSelection();
  if (!selection) throw new Error('Expected document selection support');
  return selection;
}

function selectEditorText(): HTMLElement {
  const editor = document.createElement('div');
  editor.className = 'codemirror-editor';
  editor.dataset.floatingToolbarTest = '';
  const text = document.createTextNode('Selected text');
  editor.append(text);
  document.body.append(editor);

  const range = document.createRange();
  range.selectNodeContents(text);

  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  return editor;
}

function FloatingToolbarHarness({ onBold }: { onBold: () => void }) {
  const { keepVisible, position, visible } = useFloatingToolbar();

  return (
    <FloatingToolbar
      {...createProps({
        onBold: () => {
          keepVisible();
          onBold();
        },
        onInteractionStart: keepVisible,
        position,
        visible,
      })}
    />
  );
}

describe('FloatingToolbar', () => {
  afterEach(() => {
    floatingMocks.isPositioned = false;
    floatingMocks.setFloating.mockClear();
    floatingMocks.setPositionReference.mockClear();
    getSelection().removeAllRanges();
    document.querySelectorAll('[data-floating-toolbar-test]').forEach((element) => {
      element.remove();
    });
    vi.useRealTimers();
  });

  it('sets and clears the Floating UI virtual position reference', () => {
    const position = createPosition();
    const { rerender } = render(<FloatingToolbar {...createProps({ position })} />);

    expect(floatingMocks.setPositionReference).toHaveBeenCalledWith(
      expect.objectContaining({
        contextElement: position.commonAncestorContainer,
        getBoundingClientRect: expect.any(Function),
        getClientRects: expect.any(Function),
      }),
    );

    rerender(<FloatingToolbar {...createProps({ position: null, visible: false })} />);

    expect(floatingMocks.setPositionReference).toHaveBeenLastCalledWith(null);
  });

  it('keeps the toolbar hidden until Floating UI positions it', () => {
    const props = createProps();
    const { rerender } = render(<FloatingToolbar {...props} />);

    expect(screen.getByTitle('Bold (Ctrl+B)').parentElement).toHaveClass('invisible');

    floatingMocks.isPositioned = true;
    rerender(<FloatingToolbar {...props} />);

    expect(screen.getByTitle('Bold (Ctrl+B)').parentElement).not.toHaveClass('invisible');
  });

  it('shows controls for a collapsed table caret without expanding the selection', () => {
    vi.useFakeTimers();
    floatingMocks.isPositioned = true;
    const editor = selectEditorText();
    const table = document.createElement('div');
    table.className = 'cm-md-table';
    const row = document.createElement('div');
    row.className = 'cm-line';
    const cell = document.createElement('span');
    cell.className = 'cm-md-table-cell';
    cell.textContent = '\u00a0';
    row.append(cell);
    table.append(row);
    editor.replaceChildren(table);
    const range = document.createRange();
    // Empty widgets can leave the DOM caret anchored on the row, not the cell.
    range.setStart(row, 0);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    render(<FloatingToolbarHarness onBold={vi.fn()} />);

    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByTitle('Bold (Ctrl+B)').parentElement).not.toHaveClass('invisible');
    expect(getSelection().isCollapsed).toBe(true);
    expect(getSelection().anchorNode).toBe(row);

    const paragraph = document.createTextNode('Outside table');
    editor.append(paragraph);
    getSelection().collapse(paragraph, 0);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTitle('Bold (Ctrl+B)').parentElement).toHaveClass('invisible');
  });

  it('prevents mouse presses from taking the editor selection', () => {
    render(<FloatingToolbar {...createProps({ isInTableActive: true })} />);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    fireEvent(screen.getByTitle('Add Row Above'), event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('runs a formatting command after selection collapses during a slow button press', () => {
    vi.useFakeTimers();
    floatingMocks.isPositioned = true;
    const onBold = vi.fn();
    selectEditorText();
    render(<FloatingToolbarHarness onBold={onBold} />);

    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(100);
    });

    const boldButton = screen.getByTitle('Bold (Ctrl+B)');

    floatingMocks.setPositionReference.mockClear();
    fireEvent.pointerDown(boldButton);
    act(() => {
      getSelection().removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(301);
    });

    expect(boldButton.parentElement).not.toHaveClass('invisible');
    expect(floatingMocks.setPositionReference).toHaveBeenLastCalledWith(
      expect.objectContaining({ getBoundingClientRect: expect.any(Function) }),
    );

    fireEvent.click(boldButton);

    expect(onBold).toHaveBeenCalledOnce();
    expect(boldButton.parentElement).not.toHaveClass('invisible');
  });
});
