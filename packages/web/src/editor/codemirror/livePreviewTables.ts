import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import {
  BlockWrapper,
  Decoration,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import type { PreviewNodeRef, PreviewTreeNode } from './livePreviewTypes';
import { EmptyTableCellWidget } from './livePreviewWidgets';

// The block-wrapper facet can be queried for every view update, including
// selection and scroll updates. Parsing the same tree for tables each time
// would reintroduce document-wide work outside the viewport preview plugin.
const tableWrappersByTree = new WeakMap<
  ReturnType<typeof syntaxTree>,
  ReturnType<typeof BlockWrapper.set>
>();

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

function tableColumnCount(state: EditorState, node: PreviewTreeNode): number {
  let table: PreviewTreeNode | null = node.name === 'Table' ? node : node.parent;
  while (table && table.name !== 'Table') table = table.parent;
  const header = table?.firstChild;
  if (!header) return 1;
  let delimiters = 0;
  for (let child = header.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableDelimiter') delimiters += 1;
  }
  const headerText = state.sliceDoc(header.from, header.to).trim();
  return Math.max(
    1,
    delimiters + 1 - Number(headerText.startsWith('|')) - Number(headerText.endsWith('|')),
  );
}

/** Add GFM table decorations. Returns true when the node was handled. */
export function addTablePreviewDecoration(
  state: EditorState,
  node: PreviewNodeRef,
  ranges: Range<Decoration>[],
): boolean {
  if (node.name === 'TableHeader' || node.name === 'TableRow') {
    const expectedColumns = tableColumnCount(state, node.node);
    let columnIndex = 0;
    ranges.push(
      Decoration.line({
        class:
          node.name === 'TableHeader'
            ? 'cm-md-table-header'
            : `cm-md-table-row${node.node.nextSibling ? '' : ' cm-md-table-last-row'}`,
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
            class: [
              'cm-md-table-cell',
              columnAlignment(state, child),
              columnIndex >= expectedColumns ? 'cm-md-table-overflow-cell' : '',
            ]
              .filter(Boolean)
              .join(' '),
          }).range(cellFrom, cellTo),
        );
        columnIndex += 1;
        from = cellTo;
      } else if (child.name === 'TableDelimiter' && child.prevSibling?.name === 'TableDelimiter') {
        // Lezer omits TableCell nodes for empty columns. Render a real cell
        // rather than relying on anonymous boxes from the source whitespace.
        const cellFrom = child.prevSibling.to;
        if (from < cellFrom) ranges.push(Decoration.replace({}).range(from, cellFrom));
        const alignment = [
          columnAlignment(state, child),
          columnIndex >= expectedColumns ? 'cm-md-table-overflow-cell' : '',
        ]
          .filter(Boolean)
          .join(' ');
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
        columnIndex += 1;
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

type SourceRange = { from: number; to: number };

function lineRange(state: EditorState, from: number, to: number): SourceRange {
  const first = Math.max(1, state.doc.lineAt(from).number - 1);
  const last = Math.min(state.doc.lines, state.doc.lineAt(to).number + 1);
  return { from: state.doc.line(first).from, to: state.doc.line(last).to };
}

function mergeRanges(ranges: SourceRange[]): SourceRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: SourceRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function collectTableWrappers(
  view: EditorView,
  ranges: readonly SourceRange[],
): Range<BlockWrapper>[] {
  const tree = syntaxTree(view.state);
  const wrappers = new Map<number, Range<BlockWrapper>>();
  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'Table') return undefined;
        const columns = tableColumnCount(view.state, node.node);
        wrappers.set(
          node.from,
          BlockWrapper.create({
            tagName: 'div',
            attributes: {
              class: 'cm-md-table',
              role: 'table',
              style: `--cm-table-columns: ${columns}`,
            },
          }).range(node.from, node.to),
        );
        return false;
      },
    });
  }
  return [...wrappers.values()];
}

function fullDocumentRange(state: EditorState): SourceRange {
  return { from: 0, to: state.doc.length };
}

/** Maintain wrappers by rescanning only changed context and the current
 * viewport. Table nodes outside those regions are retained and mapped. */
export const tableWrapperPlugin = ViewPlugin.fromClass(
  class {
    wrappers: ReturnType<typeof BlockWrapper.set>;
    tree: ReturnType<typeof syntaxTree>;
    viewport: SourceRange;

    constructor(readonly view: EditorView) {
      this.tree = syntaxTree(view.state);
      this.wrappers = BlockWrapper.set(
        collectTableWrappers(view, [fullDocumentRange(view.state)]),
        true,
      );
      this.viewport = { ...view.viewport };
    }

    update(update: ViewUpdate): void {
      const nextTree = syntaxTree(update.state);
      const refreshViewport = update.viewportChanged || nextTree !== this.tree;
      if (!update.docChanged && !refreshViewport) return;

      const oldRanges: SourceRange[] = [];
      const newRanges: SourceRange[] = [];
      if (update.docChanged) {
        update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
          oldRanges.push(lineRange(update.startState, fromA, toA));
          newRanges.push(lineRange(update.state, fromB, toB));
        });
      }
      if (refreshViewport) {
        oldRanges.push(lineRange(update.startState, this.viewport.from, this.viewport.to));
        newRanges.push(lineRange(update.state, update.view.viewport.from, update.view.viewport.to));
      }
      const oldRegions = mergeRanges(oldRanges);
      const newRegions = mergeRanges(newRanges);

      if (oldRegions.length) {
        const filterFrom = Math.min(...oldRegions.map((range) => range.from));
        const filterTo = Math.max(...oldRegions.map((range) => range.to)) + 1;
        this.wrappers = this.wrappers.update({
          filterFrom,
          filterTo,
          filter: (from, to) => !oldRegions.some((range) => from <= range.to && to >= range.from),
        });
      }
      this.wrappers = this.wrappers.map(update.changes);

      const existingStarts = new Set<number>();
      this.wrappers.between(0, update.state.doc.length, (from) => {
        existingStarts.add(from);
      });
      const added = collectTableWrappers(update.view, newRegions).filter((range) => {
        if (existingStarts.has(range.from)) return false;
        existingStarts.add(range.from);
        return true;
      });
      this.wrappers = this.wrappers.update({ add: added, sort: true });
      this.tree = nextTree;
      this.viewport = { ...update.view.viewport };
    }
  },
);

function scanTableWrappers(view: EditorView) {
  const tree = syntaxTree(view.state);
  const cached = tableWrappersByTree.get(tree);
  if (cached) return cached;
  const wrappers = BlockWrapper.set(
    collectTableWrappers(view, [fullDocumentRange(view.state)]),
    true,
  );
  tableWrappersByTree.set(tree, wrappers);
  return wrappers;
}

export function buildTableWrappers(view: EditorView) {
  return view.plugin(tableWrapperPlugin)?.wrappers ?? scanTableWrappers(view);
}
