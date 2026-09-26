import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { linkMarkdown, newLinkTarget } from '../../editor/codemirror/visualEditorTargets';
import { showInfoToast } from '../../utils/toast';
import { ensureAbsoluteUrl } from '../../utils/url';
import { selectedCodeBlock, toggleCodeBlock } from './codeBlockCommands';
import { toggleInlineFormatting } from './inlineFormattingCommands';
import { toggleMarkdownList } from './markdownListTransforms';

interface EditorFormattingCommandOptions {
  editor: EditorView | null;
  keepVisible(): void;
  reposition(): void;
  updateActiveStates(): void;
  uploadImage?: (file: File) => void;
}

export interface EditorFormattingCommands {
  handleBlockquote(): void;
  handleBold(): void;
  handleBulletList(): void;
  handleCode(): void;
  handleH1(): void;
  handleH2(): void;
  handleH3(): void;
  handleH4(): void;
  handleH5(): void;
  handleH6(): void;
  handleImageUploadFromSlash(): void;
  handleInsertDivider(): void;
  handleInsertTag(): void;
  handleItalic(): void;
  handleLink(): void;
  handleOrderedList(): void;
  handleStrike(): void;
  handleTaskList(): void;
  runBlockCommand(nodeName: string, attrs?: Record<string, unknown>): void;
}

function replaceSelection(view: EditorView, insert: string, cursorOffset = insert.length): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + cursorOffset },
    scrollIntoView: true,
    userEvent: 'input',
  });
}

function selectedLineRange(view: EditorView): { from: number; to: number; text: string } {
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from);
  const selectedThrough =
    selection.to > selection.from && view.state.doc.lineAt(selection.to).from === selection.to
      ? selection.to - 1
      : selection.to;
  const last = view.state.doc.lineAt(selectedThrough);
  return { from: first.from, to: last.to, text: view.state.sliceDoc(first.from, last.to) };
}

function replaceSelectedLines(view: EditorView, transform: (lines: string[]) => string[]): void {
  const selection = view.state.selection.main;
  const range = selectedLineRange(view);
  const insert = transform(range.text.split('\n')).join('\n');
  const selectionSpec = selection.empty
    ? {
        anchor: Math.max(
          range.from,
          Math.min(range.from + insert.length, selection.head + insert.length - range.text.length),
        ),
      }
    : { anchor: range.from, head: range.from + insert.length };
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: selectionSpec,
    scrollIntoView: true,
    userEvent: 'input',
  });
}

function convertSelectionToParagraph(view: EditorView): void {
  const state = view.state;
  const selected = selectedLineRange(view);
  if (!ensureSyntaxTree(state, selected.to, 50)) {
    showInfoToast('Markdown is still parsing. Try again, or select a smaller range.');
    return;
  }
  const changes: ChangeSpec[] = [];
  const setextTitleLines = new Set<number>();

  syntaxTree(state).iterate({
    from: selected.from,
    to: selected.to,
    enter(node) {
      if (
        !/^SetextHeading[12]$/.test(node.name) ||
        node.to < selected.from ||
        node.from > selected.to
      ) {
        return;
      }
      const titleLine = state.doc.lineAt(node.from);
      const underlineLine = state.doc.lineAt(node.to);
      setextTitleLines.add(titleLine.number);
      // Remove the newline and underline while leaving the title text and
      // caret positions intact.
      changes.push({ from: titleLine.to, to: underlineLine.to });
    },
  });

  const firstLineNumber = state.doc.lineAt(selected.from).number;
  const lastLineNumber = state.doc.lineAt(selected.to).number;
  for (let lineNumber = firstLineNumber; lineNumber <= lastLineNumber; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const match = line.text.match(/^#{1,6}\s+/);
    if (match) changes.push({ from: line.from, to: line.from + match[0].length });
  }

  for (const lineNumber of setextTitleLines) {
    const line = state.doc.line(lineNumber);
    const match = line.text.match(/^#{1,6}\s+/);
    if (match) changes.push({ from: line.from, to: line.from + match[0].length });
  }

  if (changes.length === 0) return;
  const selection = state.selection.main;
  const changeSet = state.changes(changes);
  view.dispatch({
    changes: changeSet,
    selection: selection.empty
      ? { anchor: changeSet.mapPos(selection.head, -1) }
      : {
          anchor: changeSet.mapPos(selection.anchor, 1),
          head: changeSet.mapPos(selection.head, -1),
        },
    scrollIntoView: true,
    userEvent: 'input',
  });
}

function toggleBlockquote(view: EditorView): void {
  const { state } = view;
  const selection = state.selection.main;
  let node = syntaxTree(state).resolveInner(selection.from, 1);
  while (node.name !== 'Blockquote' && node.parent) node = node.parent;
  const quote = node.name === 'Blockquote' && node.to >= selection.to ? node : null;
  const range = quote ?? selectedLineRange(view);
  const firstLine = state.doc.lineAt(range.from).number;
  const lastLine = state.doc.lineAt(range.to).number;
  const lines = Array.from({ length: lastLine - firstLine + 1 }, (_, index) =>
    state.doc.line(firstLine + index),
  );
  const pattern = /^( {0,3})>[ \t]?/;
  const remove = quote !== null || lines.every((line) => pattern.test(line.text));
  const edits: ChangeSpec[] = [];
  for (const line of lines) {
    const match = line.text.match(pattern);
    if (remove && match)
      edits.push({ from: line.from + (match[1]?.length ?? 0), to: line.from + match[0].length });
    else if (!remove && !match) edits.push({ from: line.from, insert: '> ' });
  }
  if (!edits.length) return;
  const changes = state.changes(edits);
  const from = changes.mapPos(selection.from, 1);
  const to = changes.mapPos(selection.to, -1);
  view.dispatch({
    changes,
    selection: selection.empty
      ? { anchor: from }
      : selection.anchor <= selection.head
        ? { anchor: from, head: to }
        : { anchor: to, head: from },
    scrollIntoView: true,
    userEvent: 'input',
  });
}

export function createEditorFormattingCommands({
  editor,
  keepVisible,
  reposition,
  updateActiveStates,
  uploadImage,
}: EditorFormattingCommandOptions): EditorFormattingCommands {
  const updateSoon = () => {
    window.setTimeout(updateActiveStates, 0);
    window.setTimeout(reposition, 0);
  };
  const run = (command: (view: EditorView) => void) => {
    if (!editor || editor.state.readOnly) return;
    keepVisible();
    command(editor);
    editor.focus();
    updateSoon();
  };

  const runBlockCommand = (nodeName: string, attrs?: Record<string, unknown>) => {
    if (nodeName === 'code_block') {
      run(toggleCodeBlock);
      return;
    }
    if (nodeName === 'paragraph') {
      run((view) => {
        if (selectedCodeBlock(view.state)) toggleCodeBlock(view);
        else convertSelectionToParagraph(view);
      });
      return;
    }
    if (nodeName === 'heading') {
      const level = Number(attrs?.level ?? 1);
      run((view) => {
        const prefix = `${'#'.repeat(Math.min(6, Math.max(1, level)))} `;
        const lines = selectedLineRange(view).text.split('\n');
        const allActive = lines.every((line) => line.startsWith(prefix));
        replaceSelectedLines(view, (selected) =>
          selected.map((line) =>
            allActive ? line.slice(prefix.length) : `${prefix}${line.replace(/^#{1,6}\s+/, '')}`,
          ),
        );
      });
    }
  };

  const handleImageUploadFromSlash = () => {
    if (!uploadImage) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) uploadImage(file);
    };
    input.click();
  };

  const handleLink = () => {
    if (!editor || editor.state.readOnly || editor.state.selection.main.empty) return;
    const url = prompt('Enter link URL:');
    if (!url) return;
    const safeUrl = ensureAbsoluteUrl(url);
    if (!safeUrl) {
      showInfoToast('Enter a safe HTTP, HTTPS, email, phone, or relative link');
      return;
    }
    run((view) => {
      const target = newLinkTarget(view.state);
      if (target) replaceSelection(view, linkMarkdown(target, target.text, safeUrl));
    });
  };

  const handleCode = () =>
    run((view) => {
      const selection = view.state.selection.main;
      const selected = view.state.sliceDoc(selection.from, selection.to);
      if (selectedCodeBlock(view.state) || selected.includes('\n')) toggleCodeBlock(view);
      else toggleInlineFormatting(view, 'code');
    });

  return {
    handleBlockquote: () => run(toggleBlockquote),
    handleBold: () => run((view) => toggleInlineFormatting(view, 'bold')),
    handleBulletList: () =>
      run((view) => replaceSelectedLines(view, (lines) => toggleMarkdownList(lines, 'bullet'))),
    handleCode,
    handleH1: () => runBlockCommand('heading', { level: 1 }),
    handleH2: () => runBlockCommand('heading', { level: 2 }),
    handleH3: () => runBlockCommand('heading', { level: 3 }),
    handleH4: () => runBlockCommand('heading', { level: 4 }),
    handleH5: () => runBlockCommand('heading', { level: 5 }),
    handleH6: () => runBlockCommand('heading', { level: 6 }),
    handleImageUploadFromSlash,
    handleInsertDivider: () => run((view) => replaceSelection(view, '\n---\n')),
    handleInsertTag: () => run((view) => replaceSelection(view, '#tag ')),
    handleItalic: () => run((view) => toggleInlineFormatting(view, 'italic')),
    handleLink,
    handleOrderedList: () =>
      run((view) => replaceSelectedLines(view, (lines) => toggleMarkdownList(lines, 'ordered'))),
    handleStrike: () => run((view) => toggleInlineFormatting(view, 'strike')),
    handleTaskList: () =>
      run((view) => replaceSelectedLines(view, (lines) => toggleMarkdownList(lines, 'task'))),
    runBlockCommand,
  };
}
