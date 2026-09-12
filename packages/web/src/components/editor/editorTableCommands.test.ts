import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { describe, expect, it, vi } from 'vitest';
import { createEditorTableCommands, moveToAdjacentTableCell } from './editorTableCommands';

function createTableEditor(document: string, selectedText: string | number, readOnly = false) {
  const position = typeof selectedText === 'number' ? selectedText : document.indexOf(selectedText);
  if (position < 0) throw new Error(`Selection text not found: ${selectedText}`);
  const editor = new EditorView({
    state: EditorState.create({
      doc: document,
      selection: { anchor: position },
      extensions: [markdown({ extensions: [GFM] }), EditorState.readOnly.of(readOnly)],
    }),
  });
  const commands = createEditorTableCommands(editor, vi.fn(), vi.fn());
  return { commands, editor };
}

describe('editor table commands', () => {
  it.each([
    [
      'handleAddColBefore',
      '| A |  | B | C |',
      '| :--- | --- | :---: | ---: |',
      '| Left | New |  | Right |',
    ],
    [
      'handleAddColAfter',
      '| A | B |  | C |',
      '| :--- | :---: | --- | ---: |',
      '| Left |  | New | Right |',
    ],
  ] as const)('targets an empty middle cell with %s and focuses the inserted cell', (command, header, separator, body) => {
    const document = '| A | B | C |\n| :--- | :---: | ---: |\n| Left |  | Right |';
    const { commands, editor } = createTableEditor(document, document.indexOf('|  |') + 2);

    commands[command]();
    editor.dispatch({ changes: { from: editor.state.selection.main.head, insert: 'New' } });

    expect(editor.state.doc.toString()).toBe([header, separator, body].join('\n'));
    editor.destroy();
  });

  it('uses the correct column when the caret is in cell padding', () => {
    const document = '| A | B |\n| --- | --- |\n| First | Second |';
    const { commands, editor } = createTableEditor(document, document.indexOf('Second') - 1);
    commands.handleAddColAfter();
    expect(editor.state.doc.line(1).text).toBe('| A | B |  |');
    editor.destroy();
  });

  it('keeps repeated row and column insertions inside the selected table', () => {
    const document = '| A | B |\n| --- | --- |\n| First | Second |';
    const { commands, editor } = createTableEditor(document, 'Second');
    commands.handleAddRowAfter();
    commands.handleAddRowAfter();
    expect(editor.state.doc.lines).toBe(5);

    commands.handleAddColAfter();
    commands.handleAddColAfter();
    expect(editor.state.doc.line(1).text).toBe('| A | B |  |  |');
    editor.dispatch({ changes: { from: editor.state.selection.main.head, insert: 'New' } });
    expect(editor.state.doc.line(5).text).toBe('|  |  |  | New |');
    editor.destroy();
  });

  it('inserts above the selected body row without changing surrounding content', () => {
    const document =
      'Before\n\n| A | B |\n| --- | --- |\n| First | Row |\n| Second | Row |\n\nAfter';
    const { commands, editor } = createTableEditor(document, 'Second');
    commands.handleAddRowBefore();
    commands.handleAddRowBefore();
    expect(editor.state.doc.toString()).toBe(
      'Before\n\n| A | B |\n| --- | --- |\n| First | Row |\n|  |  |\n|  |  |\n| Second | Row |\n\nAfter',
    );
    editor.destroy();
  });

  it('inserts above the header while preserving the old header and alignment', () => {
    const document = '| A | B |\n| :--- | ---: |\n| First | Row |';
    const { commands, editor } = createTableEditor(document, 'B');
    commands.handleAddRowBefore();
    editor.dispatch({ changes: { from: editor.state.selection.main.head, insert: 'New' } });
    expect(editor.state.doc.toString()).toBe(
      '|  | New |\n| :--- | ---: |\n| A | B |\n| First | Row |',
    );
    editor.destroy();
  });

  it('handles the last table boundary and a terminal escaped pipe', () => {
    const document = 'A | B\n--- | ---\nLeft | Right\\|';
    const { commands, editor } = createTableEditor(document, document.length);
    commands.handleAddColAfter();
    expect(editor.state.doc.toString()).toBe(
      '| A | B |  |\n| --- | --- | --- |\n| Left | Right\\| |  |',
    );
    editor.destroy();
  });

  it('navigates empty cells with Tab, skips the separator, and appends a row at the end', () => {
    const document = '| A | B |\n| --- | --- |\n|  |  |';
    const { editor } = createTableEditor(document, 'B');
    expect(moveToAdjacentTableCell(editor, 1)).toBe(true);
    expect(editor.state.doc.lineAt(editor.state.selection.main.head).number).toBe(3);
    const firstCell = editor.state.selection.main.head;
    expect(moveToAdjacentTableCell(editor, 1)).toBe(true);
    expect(editor.state.selection.main.head).toBeGreaterThan(firstCell);
    expect(moveToAdjacentTableCell(editor, -1)).toBe(true);
    expect(editor.state.selection.main.head).toBe(firstCell);
    moveToAdjacentTableCell(editor, 1);
    expect(moveToAdjacentTableCell(editor, 1)).toBe(true);
    expect(editor.state.doc.lines).toBe(4);
    expect(editor.state.doc.lineAt(editor.state.selection.main.head).number).toBe(4);
    editor.destroy();
  });

  it('does not mutate read-only tables', () => {
    const document = '| A | B |\n| --- | --- |\n| First | Second |';
    const { commands, editor } = createTableEditor(document, 'Second', true);
    commands.handleAddRowBefore();
    commands.handleAddRowAfter();
    commands.handleAddColBefore();
    commands.handleAddColAfter();
    expect(moveToAdjacentTableCell(editor, 1)).toBe(false);
    expect(editor.state.doc.toString()).toBe(document);
    editor.destroy();
  });

  it('adds a column without damaging escaped pipes, code, or alignment', () => {
    const document = ['| Alpha | Bravo |', '| :--- | ---: |', '| `a|b` | left \\| right |'].join(
      '\n',
    );
    const { commands, editor } = createTableEditor(document, 'Bravo');

    commands.handleAddColAfter();

    expect(editor.state.doc.toString()).toBe(
      ['| Alpha | Bravo |  |', '| :--- | ---: | --- |', '| `a|b` | left \\| right |  |'].join('\n'),
    );
    editor.destroy();
  });

  it('adds a row after the selected body row', () => {
    const document = ['| A | B |', '| --- | --- |', '| First | Row |'].join('\n');
    const { commands, editor } = createTableEditor(document, 'First');

    commands.handleAddRowAfter();

    expect(editor.state.doc.toString()).toBe(
      ['| A | B |', '| --- | --- |', '| First | Row |', '|  |  |'].join('\n'),
    );
    editor.destroy();
  });

  it('deletes the complete table in one action', () => {
    const document = ['| A | B |', '| --- | --- |', '| First | Row |'].join('\n');
    const { commands, editor } = createTableEditor(document, 'First');

    commands.handleDeleteTable();

    expect(editor.state.doc.toString()).toBe('');
    editor.destroy();
  });
});
