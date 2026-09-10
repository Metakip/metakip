import type { Editor } from '@milkdown/core';
import { commandsCtx, editorViewCtx } from '@milkdown/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import { insertTableCommand } from '@milkdown/preset-gfm';
import { TextSelection } from 'prosemirror-state';
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
} from 'prosemirror-tables';

type TableAction =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'addColBefore'
  | 'addColAfter'
  | 'deleteRow'
  | 'deleteCol'
  | 'deleteTable';

export type EditorTableCommands = {
  handleInsertTable: () => void;
  handleAddRowBefore: () => void;
  handleAddRowAfter: () => void;
  handleAddColBefore: () => void;
  handleAddColAfter: () => void;
  handleDeleteRow: () => void;
  handleDeleteCol: () => void;
  handleDeleteTable: () => void;
};

export type TableEdgeAction = 'column' | 'row';

function getLastTableCell(table: HTMLTableElement): HTMLTableCellElement | null {
  const lastRow = table.rows.item(table.rows.length - 1);
  return lastRow?.cells.item(lastRow.cells.length - 1) ?? null;
}

export function addTableEdge(
  editor: Editor | null,
  table: HTMLTableElement,
  action: TableEdgeAction,
): boolean {
  if (!editor || !table.isConnected) return false;

  let added = false;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx) as EditorView | undefined;
    const lastCell = getLastTableCell(table);
    if (!view?.editable || !lastCell) return;

    const cellPosition = view.posAtDOM(lastCell, 0);
    const resolvedPosition = view.state.doc.resolve(cellPosition);
    view.dispatch(view.state.tr.setSelection(TextSelection.near(resolvedPosition)));

    added =
      action === 'column'
        ? addColumnAfter(view.state, view.dispatch)
        : addRowAfter(view.state, view.dispatch);

    if (added) view.focus();
  });

  return added;
}

export function createEditorTableCommands(
  editor: Editor | null,
  keepVisible: () => void,
  updateActiveStates: () => void,
): EditorTableCommands {
  const handleInsertTable = () => {
    if (!editor) return;
    keepVisible();
    editor.action((ctx) => {
      ctx.get(commandsCtx).call(insertTableCommand.key, { row: 3, col: 3 });
    });
    setTimeout(updateActiveStates, 0);
  };

  const handleTableAction = (action: TableAction) => {
    if (!editor) return;
    keepVisible();
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx) as EditorView | undefined;
      if (!view || !isInTable(view.state)) return;
      const { state, dispatch } = view;
      const commands: Record<TableAction, () => void> = {
        addRowBefore: () => addRowBefore(state, dispatch),
        addRowAfter: () => addRowAfter(state, dispatch),
        addColBefore: () => addColumnBefore(state, dispatch),
        addColAfter: () => addColumnAfter(state, dispatch),
        deleteRow: () => deleteRow(state, dispatch),
        deleteCol: () => deleteColumn(state, dispatch),
        deleteTable: () => deleteTable(state, dispatch),
      };
      commands[action]();
    });
    setTimeout(updateActiveStates, 0);
  };

  return {
    handleInsertTable,
    handleAddRowBefore: () => handleTableAction('addRowBefore'),
    handleAddRowAfter: () => handleTableAction('addRowAfter'),
    handleAddColBefore: () => handleTableAction('addColBefore'),
    handleAddColAfter: () => handleTableAction('addColAfter'),
    handleDeleteRow: () => handleTableAction('deleteRow'),
    handleDeleteCol: () => handleTableAction('deleteCol'),
    handleDeleteTable: () => handleTableAction('deleteTable'),
  };
}
