import type { Editor } from '@milkdown/core';
import { EditorView } from '@milkdown/kit/prose/view';
import { type NodeType, Schema } from 'prosemirror-model';
import { EditorState, type Transaction } from 'prosemirror-state';
import { tableNodes } from 'prosemirror-tables';
import { afterEach, describe, expect, it } from 'vitest';
import { addTableEdge } from './editorTableCommands';

function requireNodeType(schema: Schema, name: string): NodeType {
  const nodeType = schema.nodes[name];
  if (!nodeType) throw new Error(`Missing ${name} node type`);
  return nodeType;
}

function createTableView() {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { content: 'inline*', group: 'block', toDOM: () => ['p', 0] },
      text: { group: 'inline' },
      ...tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} }),
    },
  });
  const paragraph = requireNodeType(schema, 'paragraph');
  const tableCell = requireNodeType(schema, 'table_cell');
  const tableRow = requireNodeType(schema, 'table_row');
  const tableNode = requireNodeType(schema, 'table');
  const doc = requireNodeType(schema, 'doc');
  const createCell = () => tableCell.create(null, paragraph.create());
  const createRow = () => tableRow.create(null, [createCell(), createCell()]);
  const state = EditorState.create({
    doc: doc.create(null, [tableNode.create(null, [createRow(), createRow()])]),
  });
  const host = document.createElement('div');
  document.body.append(host);
  const view = new EditorView(host, { state });
  view.setProps({
    dispatchTransaction: (transaction: Transaction) => {
      view.updateState(view.state.apply(transaction));
    },
  });
  const editor = {
    action: (run: (ctx: { get: () => EditorView }) => void) => run({ get: () => view }),
  } as unknown as Editor;
  const table = view.dom.querySelector('table');
  if (!(table instanceof HTMLTableElement)) throw new Error('Table did not render');

  return { editor, host, table, view };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('addTableEdge', () => {
  it('adds a column after the table edge', () => {
    const { editor, host, table, view } = createTableView();
    cleanups.push(() => {
      view.destroy();
      host.remove();
    });

    expect(addTableEdge(editor, table, 'column')).toBe(true);
    expect(view.dom.querySelector('table')?.rows.item(0)?.cells).toHaveLength(3);
    expect(view.dom.querySelector('table')?.rows.item(1)?.cells).toHaveLength(3);
  });

  it('adds a row after the table edge', () => {
    const { editor, host, table, view } = createTableView();
    cleanups.push(() => {
      view.destroy();
      host.remove();
    });

    expect(addTableEdge(editor, table, 'row')).toBe(true);
    expect(view.dom.querySelector('table')?.rows).toHaveLength(3);
  });

  it('does not change a readonly editor', () => {
    const { editor, host, table, view } = createTableView();
    cleanups.push(() => {
      view.destroy();
      host.remove();
    });
    view.setProps({ editable: () => false });

    expect(addTableEdge(editor, table, 'row')).toBe(false);
    expect(view.dom.querySelector('table')?.rows).toHaveLength(2);
  });
});
