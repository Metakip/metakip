import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { BlockWrapper, Decoration, type EditorView } from '@codemirror/view';
import type { PreviewNodeRef, PreviewTreeNode } from './livePreviewTypes';
import { EmptyTableCellWidget } from './livePreviewWidgets';

function columnAlignment(state: EditorState, node: PreviewTreeNode): string {
  let columnIndex = 0;
  let sibling = node.prevSibling;
  while (sibling) {
    if (sibling.name === 'TableDelimiter') columnIndex += 1;
    sibling = sibling.prevSibling;
  }
  const row = node.parent;
  if (row && state.sliceDoc(row.from, row.to).trimStart().startsWith('|')) columnIndex -= 1;
  let table = row;
  while (table && table.name !== 'Table') table = table.parent;
  const separator = table ? state.doc.line(state.doc.lineAt(table.from).number + 1).text : '';
  const marker = separator
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    [columnIndex]?.trim();
  if (marker?.startsWith(':'))
    return marker.endsWith(':') ? 'cm-md-align-center' : 'cm-md-align-left';
  return marker?.endsWith(':') ? 'cm-md-align-right' : '';
}

/** Add GFM table decorations. Returns true when the node was handled. */
export function addTablePreviewDecoration(
  state: EditorState,
  node: PreviewNodeRef,
  ranges: Range<Decoration>[],
): boolean {
  if (node.name === 'TableHeader' || node.name === 'TableRow') {
    ranges.push(
      Decoration.line({
        class: node.name === 'TableHeader' ? 'cm-md-table-header' : 'cm-md-table-row',
      }).range(node.from),
    );
    // Keep cell padding inside editable cells, and hide only the pipe gaps.
    // A caret at the end of cell text must not cross a replacement decoration
    // and end up typing into the next cell.
    const line = state.doc.lineAt(node.from);
    let from = line.from;
    let child = node.node.firstChild;
    while (child) {
      if (child.name === 'TableCell') {
        const cellFrom =
          child.prevSibling?.name === 'TableDelimiter' ? child.prevSibling.to : line.from;
        const cellTo =
          child.nextSibling?.name === 'TableDelimiter' ? child.nextSibling.from : line.to;
        if (from < cellFrom) ranges.push(Decoration.replace({}).range(from, cellFrom));
        ranges.push(
          Decoration.mark({
            class: `cm-md-table-cell ${columnAlignment(state, child)}`.trim(),
          }).range(cellFrom, cellTo),
        );
        from = cellTo;
      } else if (child.name === 'TableDelimiter' && child.prevSibling?.name === 'TableDelimiter') {
        // Lezer omits TableCell nodes for empty columns. Render a real cell
        // rather than relying on anonymous boxes from the source whitespace.
        const cellFrom = child.prevSibling.to;
        if (from < cellFrom) ranges.push(Decoration.replace({}).range(from, cellFrom));
        const alignment = columnAlignment(state, child);
        ranges.push(
          cellFrom < child.from
            ? // Keep existing whitespace editable so a native caret inside a new
              // cell cannot jump past a non-editable widget into its neighbor.
              Decoration.mark({
                class: `cm-md-table-cell cm-md-table-empty-cell ${alignment}`.trim(),
              }).range(cellFrom, child.from)
            : Decoration.widget({
                widget: new EmptyTableCellWidget(cellFrom, alignment),
                side: 1,
              }).range(cellFrom),
        );
        from = child.from;
      }
      child = child.nextSibling;
    }
    if (from < line.to) ranges.push(Decoration.replace({}).range(from, line.to));
    return true;
  }
  if (node.name === 'TableCell') return true;
  if (node.name !== 'TableDelimiter') return false;
  const line = state.doc.lineAt(node.from);
  const isSeparator = node.from === line.from && node.to === line.to;
  if (isSeparator) {
    ranges.push(Decoration.line({ class: 'cm-md-table-separator' }).range(line.from));
    ranges.push(Decoration.replace({}).range(node.from, node.to));
  }
  return true;
}

export function buildTableWrappers(view: EditorView) {
  const ranges: Range<BlockWrapper>[] = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name === 'Table') {
        ranges.push(
          BlockWrapper.create({
            tagName: 'div',
            attributes: { class: 'cm-md-table', role: 'table' },
          }).range(node.from, node.to),
        );
        return false;
      }
      return undefined;
    },
  });
  return BlockWrapper.set(ranges, true);
}
