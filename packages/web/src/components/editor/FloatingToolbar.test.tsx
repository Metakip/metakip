import * as stylex from '@stylexjs/stylex';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFloatingToolbar } from '../../hooks/useFloatingToolbar';
import { createEditorCommandRegistry } from './editorCommandRegistry';
import { createEditorFormattingCommands } from './editorFormattingCommands';
import { createEditorTableCommands } from './editorTableCommands';
import type { FloatingToolbarProps } from './FloatingToolbar';
import { styles } from './FloatingToolbar.stylex';
import { INACTIVE_STATES } from './useEditorActiveStates';

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

function createProps(
  overrides: Partial<FloatingToolbarProps> = {},
  onBold: () => void = vi.fn(),
): FloatingToolbarProps {
  return {
    activeStates: INACTIVE_STATES,
    commands: createEditorCommandRegistry(
      {
        ...createEditorFormattingCommands({
          editor: null,
          keepVisible: vi.fn(),
          reposition: vi.fn(),
          updateActiveStates: vi.fn(),
        }),
        ...createEditorTableCommands(null, vi.fn(), vi.fn()),
        handleBold: onBold,
      },
      false,
    ),
    onInteractionStart: vi.fn(),
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
      {...createProps({ onInteractionStart: keepVisible, position, visible }, () => {
        keepVisible();
        onBold();
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

    const invisibleClass = stylex.props(styles.invisible).className ?? '';
    expect(screen.getByTitle('Bold (Ctrl+B)').parentElement).toHaveClass(invisibleClass);

    floatingMocks.isPositioned = true;
    rerender(<FloatingToolbar {...props} />);

    expect(screen.getByTitle('Bold (Ctrl+B)').parentElement).not.toHaveClass(invisibleClass);
  });

  it('adds a comment action without replacing formatting controls', () => {
    const onAddComment = vi.fn();
    floatingMocks.isPositioned = true;
    render(<FloatingToolbar {...createProps({ canComment: true, onAddComment })} />);

    expect(screen.getByTitle('Bold (Ctrl+B)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add comment to selection' }));
    expect(onAddComment).toHaveBeenCalledOnce();
  });

  it('shows only the comment action in comment-only mode', () => {
    floatingMocks.isPositioned = true;
    render(
      <FloatingToolbar
        {...createProps({ commentOnly: true, canComment: true, onAddComment: vi.fn() })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add comment to selection' })).toBeInTheDocument();
    expect(screen.queryByTitle('Bold (Ctrl+B)')).not.toBeInTheDocument();
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

    expect(screen.getByTitle('Bold (Ctrl+B)').parentElement).not.toHaveClass(
      stylex.props(styles.invisible).className ?? '',
    );
    expect(getSelection().isCollapsed).toBe(true);
    expect(getSelection().anchorNode).toBe(row);

    const paragraph = document.createTextNode('Outside table');
    editor.append(paragraph);
    getSelection().collapse(paragraph, 0);
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByTitle('Bold (Ctrl+B)').parentElement).toHaveClass(
      stylex.props(styles.invisible).className ?? '',
    );
  });

  it('prevents mouse presses from taking the editor selection', () => {
    render(
      <FloatingToolbar
        {...createProps({ activeStates: { ...INACTIVE_STATES, isInTableActive: true } })}
      />,
    );
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    fireEvent(screen.getByTitle('Add Row Above'), event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('announces active formatting without treating insert or delete as toggles', () => {
    floatingMocks.isPositioned = true;
    const activeStates = {
      ...INACTIVE_STATES,
      isBoldActive: true,
      isH3Active: true,
      isTaskListActive: true,
      isInTableActive: true,
    };
    render(<FloatingToolbar {...createProps({ activeStates })} />);

    expect(screen.getByRole('button', { name: /^Bold/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Italic/, pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Heading 3', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task List', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert Table' })).not.toHaveAttribute(
      'aria-pressed',
    );
    expect(screen.getByRole('button', { name: 'Delete Table' })).not.toHaveAttribute(
      'aria-pressed',
    );
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

    expect(boldButton.parentElement).not.toHaveClass(
      stylex.props(styles.invisible).className ?? '',
    );
    expect(floatingMocks.setPositionReference).toHaveBeenLastCalledWith(
      expect.objectContaining({ getBoundingClientRect: expect.any(Function) }),
    );

    fireEvent.click(boldButton);

    expect(onBold).toHaveBeenCalledOnce();
    expect(boldButton.parentElement).not.toHaveClass('invisible');
  });
});
