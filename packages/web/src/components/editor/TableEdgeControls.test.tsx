import type { Editor } from '@milkdown/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addTableEdge } from './editorTableCommands';
import { TableEdgeControls } from './TableEdgeControls';

vi.mock('./editorTableCommands', () => ({
  addTableEdge: vi.fn(() => true),
}));

const editor = {} as Editor;

class ResizeObserverMock {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function Harness({ enabled = true }: { enabled?: boolean }) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={wrapperRef} data-testid="editor-wrapper">
      <table data-testid="table">
        <tbody>
          <tr data-testid="table-row">
            <td>One</td>
            <td>Two</td>
          </tr>
        </tbody>
      </table>
      <span>Outside</span>
      <TableEdgeControls editor={editor} enabled={enabled} wrapperRef={wrapperRef} />
    </div>
  );
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

beforeEach(() => {
  vi.mocked(addTableEdge).mockClear();
});

describe('TableEdgeControls', () => {
  it('shows row and column controls while hovering a table', () => {
    render(<Harness />);
    const wrapper = screen.getByTestId('editor-wrapper');
    const table = screen.getByTestId('table');
    const row = screen.getByTestId('table-row');
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(rect(20, 40, 500, 300));
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(rect(120, 100, 240, 120));
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(120, 100, 240, 40));

    fireEvent.pointerOver(screen.getByText('One'));

    expect(screen.getByRole('button', { name: 'Add column' })).toHaveStyle({
      left: '340px',
      top: '80px',
    });
    expect(screen.getByRole('button', { name: 'Add row' })).toHaveStyle({
      left: '220px',
      top: '180px',
    });
  });

  it('adds through the existing table commands', () => {
    render(<Harness />);
    const table = screen.getByTestId('table');
    fireEvent.pointerOver(screen.getByText('One'));

    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));

    expect(addTableEdge).toHaveBeenNthCalledWith(1, editor, table, 'column');
    expect(addTableEdge).toHaveBeenNthCalledWith(2, editor, table, 'row');
  });

  it('hides the controls after leaving the editor', () => {
    render(<Harness />);
    const wrapper = screen.getByTestId('editor-wrapper');
    fireEvent.pointerOver(screen.getByText('One'));
    expect(screen.getByRole('button', { name: 'Add column' })).toBeInTheDocument();

    fireEvent.pointerLeave(wrapper);

    expect(screen.queryByRole('button', { name: 'Add column' })).not.toBeInTheDocument();
  });

  it('does not expose controls in readonly mode', () => {
    render(<Harness enabled={false} />);

    fireEvent.pointerOver(screen.getByText('One'));

    expect(screen.queryByRole('button', { name: 'Add column' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add row' })).not.toBeInTheDocument();
  });
});
