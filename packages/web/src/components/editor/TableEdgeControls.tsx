import type { Editor } from '@milkdown/core';
import { IconPlus } from '@tabler/icons-react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { addTableEdge, type TableEdgeAction } from './editorTableCommands';

type TableBounds = {
  columnTop: number;
  height: number;
  left: number;
  table: HTMLTableElement;
  top: number;
  width: number;
};

interface TableEdgeControlsProps {
  editor: Editor | null;
  enabled: boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
}

function measureTable(
  table: HTMLTableElement,
  row: HTMLTableRowElement | null,
  wrapper: HTMLDivElement,
): TableBounds {
  const tableRect = table.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();
  const rowRect = row?.getBoundingClientRect();

  return {
    columnTop: rowRect
      ? rowRect.top - wrapperRect.top + rowRect.height / 2
      : tableRect.top - wrapperRect.top + tableRect.height / 2,
    height: tableRect.height,
    left: tableRect.left - wrapperRect.left,
    table,
    top: tableRect.top - wrapperRect.top,
    width: tableRect.width,
  };
}

function boundsAreEqual(current: TableBounds | null, next: TableBounds): boolean {
  return (
    current?.table === next.table &&
    current.columnTop === next.columnTop &&
    current.height === next.height &&
    current.left === next.left &&
    current.top === next.top &&
    current.width === next.width
  );
}

export function TableEdgeControls({ editor, enabled, wrapperRef }: TableEdgeControlsProps) {
  const [bounds, setBounds] = useState<TableBounds | null>(null);
  const activeTableRef = useRef<HTMLTableElement | null>(null);
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const hideControls = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    activeTableRef.current = null;
    activeRowRef.current = null;
    setBounds(null);
  }, []);

  const updatePosition = useCallback(() => {
    const wrapper = wrapperRef.current;
    const table = activeTableRef.current;
    if (!wrapper || !table?.isConnected) {
      hideControls();
      return;
    }

    const nextBounds = measureTable(table, activeRowRef.current, wrapper);
    setBounds((current) => (boundsAreEqual(current, nextBounds) ? current : nextBounds));
  }, [hideControls, wrapperRef]);

  const showControls = useCallback(
    (table: HTMLTableElement, row: HTMLTableRowElement | null) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      if (activeTableRef.current !== table) {
        resizeObserverRef.current?.disconnect();
        activeTableRef.current = table;
        resizeObserverRef.current = new ResizeObserver(updatePosition);
        resizeObserverRef.current.observe(table);
        resizeObserverRef.current.observe(wrapper);
      }
      activeRowRef.current = row;

      updatePosition();
    },
    [updatePosition, wrapperRef],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!enabled || !wrapper) {
      hideControls();
      return undefined;
    }

    const handlePointerOver = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('[data-table-edge-control]')) return;

      const table = target.closest('table');
      if (table instanceof HTMLTableElement && wrapper.contains(table)) {
        const row = target.closest('tr');
        showControls(table, row instanceof HTMLTableRowElement ? row : null);
        return;
      }

      hideControls();
    };

    const handlePointerLeave = () => hideControls();

    wrapper.addEventListener('pointerover', handlePointerOver);
    wrapper.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      wrapper.removeEventListener('pointerover', handlePointerOver);
      wrapper.removeEventListener('pointerleave', handlePointerLeave);
      hideControls();
    };
  }, [enabled, hideControls, showControls, wrapperRef]);

  const handleAdd = (action: TableEdgeAction) => {
    if (!bounds) return;
    if (!addTableEdge(editor, bounds.table, action)) return;
    requestAnimationFrame(updatePosition);
  };

  if (!enabled || !bounds) return null;

  return (
    <div className="table-edge-controls">
      <button
        type="button"
        className="table-edge-control table-edge-control-column"
        style={{
          left: bounds.left + bounds.width,
          top: bounds.columnTop,
        }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => handleAdd('column')}
        aria-label="Add column"
        title="Add column"
        data-table-edge-control="column"
      >
        <IconPlus size={18} stroke={1.8} />
      </button>
      <button
        type="button"
        className="table-edge-control table-edge-control-row"
        style={{
          left: bounds.left + bounds.width / 2,
          top: bounds.top + bounds.height,
        }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => handleAdd('row')}
        aria-label="Add row"
        title="Add row"
        data-table-edge-control="row"
      >
        <IconPlus size={18} stroke={1.8} />
      </button>
    </div>
  );
}
