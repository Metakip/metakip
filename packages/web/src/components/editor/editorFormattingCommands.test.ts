import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { GFM } from '@lezer/markdown';
import { describe, expect, it, vi } from 'vitest';
import { selectedCodeBlock } from './codeBlockCommands';
import { createEditorFormattingCommands } from './editorFormattingCommands';
import {
  inlineFormattingState,
  movePastInlineFormatting,
  toggleInlineFormatting,
} from './inlineFormattingCommands';
import { deriveActiveStates } from './useEditorActiveStates';

function createCommands(document: string, anchor = 0, head = document.length, readOnly = false) {
  const editor = new EditorView({
    state: EditorState.create({
      doc: document,
      selection: { anchor, head },
      extensions: [markdown({ extensions: [GFM] }), EditorState.readOnly.of(readOnly)],
    }),
  });
  const commands = createEditorFormattingCommands({
    editor,
    keepVisible: vi.fn(),
    reposition: vi.fn(),
    updateActiveStates: vi.fn(),
  });
  return { commands, editor };
}

function createInlineEditor(document = '', anchor = 0, readOnly = false): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: document,
      selection: { anchor },
      extensions: [
        markdown({ extensions: [GFM] }),
        inlineFormattingState,
        EditorState.readOnly.of(readOnly),
      ],
    }),
  });
}

describe('editor formatting commands', () => {
  it.each([
    ['handleBold', '**', 'isBoldActive'],
    ['handleItalic', '*', 'isItalicActive'],
    ['handleStrike', '~~', 'isStrikeActive'],
    ['handleCode', '`', 'isCodeActive'],
  ] as const)('%s keeps selection-edge whitespace outside markup and toggles off again', (command, marker, active) => {
    const { commands, editor } = createCommands(' hello ');
    commands[command]();
    expect(editor.state.doc.toString()).toBe(` ${marker}hello${marker} `);
    expect(deriveActiveStates(editor.state)[active]).toBe(true);
    commands[command]();
    expect(editor.state.doc.toString()).toBe(' hello ');
    editor.destroy();
  });

  it.each([
    ['handleBold', '**hello**'],
    ['handleBold', '__hello__'],
    ['handleItalic', '*hello*'],
    ['handleItalic', '_hello_'],
    ['handleStrike', '~~hello~~'],
    ['handleCode', '`hello`'],
  ] as const)('%s removes existing formatting when the entire markup is selected', (command, source) => {
    const { commands, editor } = createCommands(source);
    commands[command]();
    expect(editor.state.doc.toString()).toBe('hello');
    editor.destroy();
  });

  it.each([
    'handleBold',
    'handleItalic',
    'handleStrike',
    'handleCode',
  ] as const)('%s can cancel a collapsed empty toggle', (command) => {
    const { commands, editor } = createCommands('');
    commands[command]();
    commands[command]();
    expect(editor.state.doc.toString()).toBe('');
    expect(editor.state.selection.main.head).toBe(0);
    editor.destroy();
  });

  it('combines bold and italic without removing the other style', () => {
    const { commands, editor } = createCommands('hello');
    commands.handleBold();
    commands.handleItalic();
    expect(editor.state.doc.toString()).toBe('***hello***');
    commands.handleItalic();
    expect(editor.state.doc.toString()).toBe('**hello**');
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('hello');
    editor.destroy();
  });

  it('removes bold from only the selected part of a bold span', () => {
    const { commands, editor } = createCommands('**hello world**', 8, 13);
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('**hello** world');
    expect(
      editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to),
    ).toBe('world');
    editor.destroy();
  });

  it('turns future typing off without removing formatting at a cursor inside a span', () => {
    const { commands, editor } = createCommands('**hello**', 4, 4);
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('**he****llo**');
    expect(editor.state.selection.main.head).toBe(6);
    editor.dispatch({ changes: { from: 6, insert: 'X' } });
    expect(editor.state.doc.toString()).toBe('**he**X**llo**');
    editor.destroy();
  });

  it('turns typing bold off and on at the end without unformatting existing text', () => {
    const { commands, editor } = createCommands('**hello**', 7, 7);
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('**hello**');
    expect(editor.state.selection.main.head).toBe(9);
    expect(deriveActiveStates(editor.state).isBoldActive).toBe(false);
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('**hello**');
    expect(editor.state.selection.main.head).toBe(7);
    expect(deriveActiveStates(editor.state).isBoldActive).toBe(true);
    editor.destroy();
  });

  it('formats multiple paragraphs without wrapping blank lines in markers', () => {
    const { commands, editor } = createCommands('First\n\nSecond');
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('**First**\n\n**Second**');
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('First\n\nSecond');
    editor.destroy();
  });

  it('keeps Markdown block prefixes outside inline formatting', () => {
    const { commands, editor } = createCommands(
      '# Heading\n- List item\n> Quote\n- # Nested heading\n- [ ] Task',
    );
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe(
      '# **Heading**\n- **List item**\n> **Quote**\n- # **Nested heading**\n- [ ] **Task**',
    );
    editor.destroy();
  });

  it('does not add inline formatting inside fenced code', () => {
    const source = '# Heading\n```\nliteral\n```\nParagraph';
    const { commands, editor } = createCommands(source);
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('# **Heading**\n```\nliteral\n```\n**Paragraph**');
    editor.destroy();
  });

  it('keeps setext heading underlines and thematic breaks intact', () => {
    const source = 'Title\n-----\n\n---\n\nParagraph';
    const { commands, editor } = createCommands(source);
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('**Title**\n-----\n\n---\n\n**Paragraph**');
    editor.destroy();
  });

  it('keeps table pipes and separator rows intact', () => {
    const source = '| A | B |\n|---|---|\n| C | D |';
    const { commands, editor } = createCommands(source);
    commands.handleBold();
    expect(editor.state.doc.toString()).toBe('| **A** | **B** |\n|---|---|\n| **C** | **D** |');
    editor.destroy();
  });

  it('uses safe inline code delimiters for literal backticks', () => {
    const { commands, editor } = createCommands('`literal');
    commands.handleCode();
    expect(editor.state.doc.toString()).toBe('`` `literal ``');
    commands.handleCode();
    expect(editor.state.doc.toString()).toBe('`literal');
    editor.destroy();
  });

  it('toggles an entire blockquote off from a lazy continuation line', () => {
    const source = '> First\ncontinued text';
    const { commands, editor } = createCommands(
      source,
      source.indexOf('text'),
      source.indexOf('text'),
    );
    commands.handleBlockquote();
    expect(editor.state.doc.toString()).toBe('First\ncontinued text');
    editor.destroy();
  });

  it('toggles blockquotes on and off while preserving the selected text', () => {
    const { commands, editor } = createCommands('First\nSecond');
    commands.handleBlockquote();
    expect(editor.state.doc.toString()).toBe('> First\n> Second');
    commands.handleBlockquote();
    expect(editor.state.doc.toString()).toBe('First\nSecond');
    editor.destroy();
  });

  it('creates a fenced block on its own lines when the selection begins mid-paragraph', () => {
    const source = 'Before alpha\nbeta after';
    const { commands, editor } = createCommands(
      source,
      source.indexOf('alpha'),
      source.indexOf(' after'),
    );
    commands.handleCode();
    expect(editor.state.doc.toString()).toBe('Before \n```\nalpha\nbeta\n```\n after');
    expect(selectedCodeBlock(editor.state)).not.toBeNull();
    commands.handleCode();
    expect(editor.state.doc.toString()).toBe('Before \nalpha\nbeta\n after');
    editor.destroy();
  });

  it('unwraps a code block from a collapsed cursor without adding inline backticks', () => {
    const source = '```js\nfirst\nlast\n```';
    const { commands, editor } = createCommands(
      source,
      source.indexOf('last'),
      source.indexOf('last'),
    );
    commands.handleCode();
    expect(editor.state.doc.toString()).toBe('first\nlast');
    expect(editor.state.selection.main.head).toBe(6);
    editor.destroy();
  });

  it('creates an empty code block through the explicit block command', () => {
    const { commands, editor } = createCommands('');
    commands.runBlockCommand('code_block');
    expect(editor.state.doc.toString()).toBe('```\n\n```');
    expect(editor.state.selection.main.head).toBe(4);
    editor.destroy();
  });

  it('converts an underlined Markdown heading to a paragraph', () => {
    const source = 'Title\n-------\nBody';
    const { commands, editor } = createCommands(source, 2, 2);

    commands.runBlockCommand('paragraph');

    expect(editor.state.doc.toString()).toBe('Title\nBody');
    editor.destroy();
  });

  it('uses a longer code fence when the selected text contains triple backticks', () => {
    const source = 'First\n```\nLast';
    const { commands, editor } = createCommands(source);
    commands.handleCode();
    expect(editor.state.doc.toString()).toBe(`\`\`\`\`\n${source}\n\`\`\`\``);
    commands.handleCode();
    expect(editor.state.doc.toString()).toBe(source);
    editor.destroy();
  });

  it('does not insert formatting punctuation into code blocks', () => {
    const source = '```\nliteral\n```';
    const { commands, editor } = createCommands(
      source,
      source.indexOf('literal'),
      source.indexOf('literal') + 7,
    );
    commands.handleBold();
    commands.handleItalic();
    commands.handleStrike();
    expect(editor.state.doc.toString()).toBe(source);
    editor.destroy();
  });

  it('does not change read-only content', () => {
    const { commands, editor } = createCommands('First\nSecond', 0, 12, true);
    commands.handleBold();
    commands.handleItalic();
    commands.handleStrike();
    commands.handleBlockquote();
    commands.handleCode();
    expect(editor.state.doc.toString()).toBe('First\nSecond');
    editor.destroy();
  });

  it('does not move or rewrite read-only inline formatting', () => {
    const editor = createInlineEditor('*hello*', 6, true);

    expect(movePastInlineFormatting(editor)).toBe(false);
    expect(editor.state.doc.toString()).toBe('*hello*');
    expect(editor.state.selection.main.head).toBe(6);
    editor.destroy();
  });

  it('does not treat an escaped delimiter as inline formatting', () => {
    const source = '\\*literal*';
    const editor = createInlineEditor(source, source.length - 1);

    expect(movePastInlineFormatting(editor)).toBe(false);
    expect(editor.state.doc.toString()).toBe(source);
    expect(editor.state.selection.main.head).toBe(source.length - 1);
    editor.destroy();
  });

  it('keeps a type-ahead formatting pair usable when content ends in whitespace', () => {
    const editor = createInlineEditor();

    toggleInlineFormatting(editor, 'italic');
    editor.dispatch({
      changes: { from: 1, insert: 'hello ' },
      selection: { anchor: 7 },
    });
    toggleInlineFormatting(editor, 'italic');

    expect(editor.state.doc.toString()).toBe('*hello* ');
    expect(editor.state.selection.main.head).toBe(8);
    editor.destroy();
  });

  it('inserts a Markdown divider in one transaction', () => {
    let dispatchCount = 0;
    const editor = new EditorView({
      state: EditorState.create({
        doc: 'Paragraph',
        extensions: EditorView.updateListener.of((update) => {
          if (update.docChanged) dispatchCount += 1;
        }),
      }),
    });
    const commands = createEditorFormattingCommands({
      editor,
      keepVisible: vi.fn(),
      reposition: vi.fn(),
      updateActiveStates: vi.fn(),
    });

    commands.handleInsertDivider();

    expect(dispatchCount).toBe(1);
    expect(editor.state.doc.toString()).toBe('\n---\nParagraph');
    editor.destroy();
  });

  it('converts an existing bullet list to a task list', () => {
    const { commands, editor } = createCommands('- First\n  - Nested');

    commands.handleTaskList();

    expect(editor.state.doc.toString()).toBe('- [ ] First\n  - [ ] Nested');
    editor.destroy();
  });

  it('does not format the next line when a selection ends at its start', () => {
    const document = 'First\nSecond';
    const { commands, editor } = createCommands(document, 0, document.indexOf('Second'));

    commands.handleBulletList();

    expect(editor.state.doc.toString()).toBe('- First\nSecond');
    editor.destroy();
  });

  it('routes an image picker selection through the managed uploader', () => {
    const uploadImage = vi.fn();
    const editor = new EditorView({
      state: EditorState.create({ doc: 'Existing content' }),
    });
    const commands = createEditorFormattingCommands({
      editor,
      keepVisible: vi.fn(),
      reposition: vi.fn(),
      updateActiveStates: vi.fn(),
      uploadImage,
    });
    const fileInput = document.createElement('input');
    vi.spyOn(fileInput, 'click').mockImplementation(() => undefined);
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(fileInput);

    commands.handleImageUploadFromSlash();
    const selectedFile = new File(['image'], 'diagram.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [selectedFile],
    });
    fileInput.dispatchEvent(new Event('change'));

    expect(uploadImage).toHaveBeenCalledWith(selectedFile);
    expect(editor.state.doc.toString()).toBe('Existing content');
    createElementSpy.mockRestore();
    editor.destroy();
  });
});
