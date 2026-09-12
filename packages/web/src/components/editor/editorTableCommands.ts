import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';

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

type ParsedTable = {
  from: number;
  to: number;
  rowIndex: number;
  columnIndex: number;
  rows: string[][];
  cells: ParsedCell[][];
};

type ParsedCell = {
  from: number;
  to: number;
  contentFrom: number;
  value: string;
};

export function moveToAdjacentTableCell(view: EditorView, direction: -1 | 1): boolean {
  const table = findTable(view);
  if (!table || table.rowIndex === 1) return false;
  const cells = table.cells.flatMap((row, rowIndex) =>
    rowIndex === 1 ? [] : row.map((cell, columnIndex) => ({ cell, rowIndex, columnIndex })),
  );
  const currentIndex = cells.findIndex(
    (cell) => cell.rowIndex === table.rowIndex && cell.columnIndex === table.columnIndex,
  );
  if (currentIndex === -1) return false;
  const next = cells[currentIndex + direction];
  if (next) {
    view.dispatch({ selection: { anchor: next.cell.contentFrom }, scrollIntoView: true });
    return true;
  }
  if (direction < 0 || view.state.readOnly) return false;
  const width = table.rows[0]?.length ?? 0;
  if (width === 0) return false;
  const rows = [...table.rows, Array<string>(width).fill('')];
  replaceTable(view, table, rows, {
    rowIndex: rows.length - 1,
    columnIndex: 0,
  });
  return true;
}

function splitRow(row: string, offset = 0): ParsedCell[] {
  let start = row.length - row.trimStart().length;
  let end = row.trimEnd().length;
  const delimiters: number[] = [];
  let escaped = false;
  let codeFenceLength = 0;
  for (let index = start; index < end; index += 1) {
    const character = row[index];
    if (character === undefined) continue;
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '`') {
      let runLength = 1;
      while (row[index + runLength] === '`') runLength += 1;
      if (codeFenceLength === 0) codeFenceLength = runLength;
      else if (codeFenceLength === runLength) codeFenceLength = 0;
      index += runLength - 1;
    } else if (character === '|' && codeFenceLength === 0) {
      delimiters.push(index);
    }
  }
  if (delimiters[0] === start) {
    start += 1;
    delimiters.shift();
  }
  if (delimiters.at(-1) === end - 1) {
    end -= 1;
    delimiters.pop();
  }
  const cells: ParsedCell[] = [];
  for (const to of [...delimiters, Math.max(start, end)]) {
    const source = row.slice(start, to);
    const value = source.trim();
    cells.push({
      from: offset + start,
      to: offset + to,
      contentFrom:
        offset +
        start +
        (value ? source.length - source.trimStart().length : Math.min(1, source.length)),
      value,
    });
    start = to + 1;
  }
  return cells;
}

function serializeRows(rows: string[][]): string {
  return rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
}

function findTable(view: EditorView): ParsedTable | null {
  const head = view.state.selection.main.head;
  const current = view.state.doc.lineAt(head);
  const tree = syntaxTree(view.state);
  let selectedNode = tree.resolveInner(head, 1);
  while (selectedNode.name !== 'Table' && selectedNode.parent) selectedNode = selectedNode.parent;
  if (selectedNode.name !== 'Table') {
    selectedNode = tree.resolveInner(head, -1);
    while (selectedNode.name !== 'Table' && selectedNode.parent) selectedNode = selectedNode.parent;
  }
  if (selectedNode.name !== 'Table') return null;
  const firstNumber = view.state.doc.lineAt(selectedNode.from).number;
  const lastPosition = Math.max(selectedNode.from, selectedNode.to - 1);
  const lastNumber = view.state.doc.lineAt(lastPosition).number;
  const lines = Array.from({ length: lastNumber - firstNumber + 1 }, (_, index) =>
    view.state.doc.line(firstNumber + index),
  );
  if (!lines[1]?.text.match(/^\s*\|?\s*:?-{3,}/)) return null;
  const cells = lines.map((line) => splitRow(line.text, line.from));
  const rowIndex = current.number - firstNumber;
  const row = cells[rowIndex];
  if (!row) return null;
  // Empty cells and cell padding have no TableCell syntax node. Use source
  // boundaries, including escaped/code pipes, rather than counting syntax nodes.
  const columnIndex = row.findIndex((cell) => head <= cell.to);
  return {
    from: selectedNode.from,
    to: selectedNode.to,
    rowIndex,
    columnIndex: columnIndex < 0 ? row.length - 1 : columnIndex,
    rows: cells.map((row) => row.map((cell) => cell.value)),
    cells,
  };
}

function replaceTable(
  view: EditorView,
  table: ParsedTable,
  rows: string[][],
  selectedCell: { rowIndex: number; columnIndex: number },
): void {
  const current = view.state.sliceDoc(table.from, table.to);
  const insert = serializeRows(rows);
  let prefix = 0;
  while (prefix < current.length && prefix < insert.length && current[prefix] === insert[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < insert.length - prefix &&
    current[current.length - 1 - suffix] === insert[insert.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const changeFrom = table.from + prefix;
  const changeTo = table.to - suffix;
  const changedText = insert.slice(prefix, insert.length - suffix);
  const lines = insert.split('\n');
  const requestedRow = Math.min(selectedCell.rowIndex, lines.length - 1);
  const rowIndex = requestedRow === 1 ? 0 : requestedRow;
  const rowFrom =
    table.from + lines.slice(0, rowIndex).reduce((length, line) => length + line.length + 1, 0);
  const cells = splitRow(lines[rowIndex] ?? '', rowFrom);
  const cell = cells[Math.min(selectedCell.columnIndex, cells.length - 1)];
  view.dispatch({
    changes: { from: changeFrom, to: changeTo, insert: changedText },
    selection: { anchor: cell?.contentFrom ?? table.from },
    scrollIntoView: true,
    userEvent: 'input',
  });
}

export function createEditorTableCommands(
  editor: EditorView | null,
  keepVisible: () => void,
  updateActiveStates: () => void,
): EditorTableCommands {
  const handleInsertTable = () => {
    if (!editor || editor.state.readOnly) return;
    keepVisible();
    const table = [
      '| Header 1 | Header 2 | Header 3 |',
      '| --- | --- | --- |',
      '|  |  |  |',
      '|  |  |  |',
    ].join('\n');
    const { from, to } = editor.state.selection.main;
    const firstLine = editor.state.doc.lineAt(from);
    const lastLine = editor.state.doc.lineAt(to);
    const prefix = editor.state.sliceDoc(firstLine.from, from);
    const suffix = editor.state.sliceDoc(to, lastLine.to);
    const contentBefore = prefix.trim() ? `${prefix}\n\n` : '';
    const contentAfter = suffix.trim() ? `\n\n${suffix}` : '';
    const insert = `${contentBefore}${table}${contentAfter}`;
    const tableStart = firstLine.from + contentBefore.length;
    editor.dispatch({
      changes: { from: firstLine.from, to: lastLine.to, insert },
      selection: { anchor: tableStart + 2, head: tableStart + 10 },
      scrollIntoView: true,
      userEvent: 'input',
    });
    editor.focus();
    window.setTimeout(updateActiveStates, 0);
  };

  const handleTableAction = (action: TableAction) => {
    if (!editor || editor.state.readOnly) return;
    const table = findTable(editor);
    if (!table) return;
    keepVisible();
    if (action === 'deleteTable') {
      editor.dispatch({ changes: { from: table.from, to: table.to }, userEvent: 'delete' });
      editor.focus();
      window.setTimeout(updateActiveStates, 0);
      return;
    }
    const rows = table.rows.map((row) => [...row]);
    const width = Math.max(...rows.map((row) => row.length));
    rows.forEach((row, index) => {
      while (row.length < width) row.push(index === 1 ? '---' : '');
    });
    let rowIndex = table.rowIndex;
    let columnIndex = table.columnIndex;
    if (action === 'addRowBefore' || action === 'addRowAfter') {
      if (action === 'addRowBefore' && rowIndex === 0) {
        // Markdown requires the header above its separator. Inserting above it
        // creates a new header and moves the original header into the body.
        const header = rows[0];
        if (!header) return;
        rows[0] = Array<string>(width).fill('');
        rows.splice(2, 0, header);
      } else {
        rowIndex = Math.max(2, rowIndex + (action === 'addRowAfter' ? 1 : 0));
        rows.splice(rowIndex, 0, Array<string>(width).fill(''));
      }
    } else if (action === 'deleteRow') {
      if (table.rowIndex <= 1 || rows.length <= 2) return;
      rows.splice(table.rowIndex, 1);
    } else if (action === 'addColBefore' || action === 'addColAfter') {
      columnIndex += action === 'addColAfter' ? 1 : 0;
      rows.forEach((row, rowIndex) => {
        row.splice(columnIndex, 0, rowIndex === 1 ? '---' : '');
      });
    } else if (action === 'deleteCol') {
      if (width <= 1) return;
      rows.forEach((row) => {
        row.splice(Math.min(table.columnIndex, row.length - 1), 1);
      });
    }
    replaceTable(editor, table, rows, { rowIndex, columnIndex });
    editor.focus();
    window.setTimeout(updateActiveStates, 0);
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
