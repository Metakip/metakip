import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView } from '@codemirror/view';
import { codeBlockRange, codeBlockText } from '../../components/editor/codeBlockCommands';
import { getHeadingId } from '../../utils/headingNavigation';
import { getHeadingText } from './headings';
import { addLinkPreviewDecoration } from './livePreviewLinks';
import { addTablePreviewDecoration } from './livePreviewTables';
import { type LivePreviewOptions, type PreviewNodeRef, selectionTouches } from './livePreviewTypes';
import {
  CopyCodeWidget,
  DividerWidget,
  ListMarkerWidget,
  MathWidget,
  TaskWidget,
} from './livePreviewWidgets';

function parentRange(node: { node: { parent: { from: number; to: number } | null } }): {
  from: number;
  to: number;
} | null {
  return node.node.parent ? { from: node.node.parent.from, to: node.node.parent.to } : null;
}

function addBlockMathDecoration(
  view: EditorView,
  node: PreviewNodeRef,
  decoratedMathBlocks: Set<number>,
  ranges: Range<Decoration>[],
): void {
  const state = view.state;
  let marks = 0;
  let child = node.node.firstChild;
  while (child) {
    if (child.name === 'MathMark') marks += 1;
    child = child.nextSibling;
  }
  if (
    marks < 2 ||
    decoratedMathBlocks.has(node.from) ||
    selectionTouches(state, node.from, node.to)
  ) {
    return;
  }

  decoratedMathBlocks.add(node.from);
  const firstLine = state.doc.lineAt(node.from);
  const lastLine = state.doc.lineAt(node.to);
  const sourceStart = firstLine.to + 1;
  const sourceEnd = Math.max(sourceStart, lastLine.from - 1);
  ranges.push(
    Decoration.replace({
      widget: new MathWidget(
        state.sliceDoc(sourceStart, sourceEnd),
        true,
        { from: node.from, to: node.to },
        state.readOnly,
      ),
    }).range(firstLine.from, firstLine.to),
  );
  for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    ranges.push(Decoration.line({ class: 'cm-md-math-hidden-line' }).range(line.from));
    if (lineNumber !== firstLine.number && line.from < line.to) {
      ranges.push(Decoration.replace({}).range(line.from, line.to));
    }
  }
}

export interface PreviewRange {
  from: number;
  to: number;
}

/** Expand a preview refresh to contain every intersected display-math block.
 * Its widget and hidden source lines must be added or removed as one unit. */
export function expandPreviewRangeForBlockMath(
  view: EditorView,
  range: PreviewRange,
): PreviewRange {
  const { doc } = view.state;
  let from = doc.lineAt(Math.max(0, Math.min(range.from, doc.length))).from;
  let to = doc.lineAt(Math.max(0, Math.min(range.to, doc.length))).to;
  if (from > to) [from, to] = [to, from];

  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'BlockMath') return undefined;
      from = Math.min(from, doc.lineAt(node.from).from);
      to = Math.max(to, doc.lineAt(node.to).to);
      return false;
    },
  });
  return { from, to };
}

function addTagDecorations(
  view: EditorView,
  ranges: Range<Decoration>[],
  from: number,
  to: number,
): void {
  const state = view.state;
  const tree = syntaxTree(state);
  for (
    let lineNumber = state.doc.lineAt(from).number;
    lineNumber <= state.doc.lineAt(to).number;
    lineNumber += 1
  ) {
    const line = state.doc.line(lineNumber);
    // A fragment without a parsed context cannot distinguish a tag from text
    // inside a code block or heading. Leave it as source until parsing catches up.
    if (!syntaxTreeAvailable(state, line.to)) continue;
    const tagPattern = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;
    let match = tagPattern.exec(line.text);
    while (match !== null) {
      const leadingLength = match[1]?.length ?? 0;
      const from = line.from + match.index + leadingLength;
      const to = from + 1 + (match[2]?.length ?? 0);
      type TreeNode = { name: string; parent: TreeNode | null };
      let cursor: TreeNode | null = tree.resolveInner(from, 1) as TreeNode;
      let excluded = false;
      while (cursor) {
        if (
          cursor.name === 'FencedCode' ||
          cursor.name === 'InlineCode' ||
          cursor.name === 'URL' ||
          /^ATXHeading/.test(cursor.name)
        ) {
          excluded = true;
          break;
        }
        cursor = cursor.parent;
      }
      if (!excluded) {
        ranges.push(Decoration.mark({ class: 'cm-md-tag' }).range(from, to));
      }
      match = tagPattern.exec(line.text);
    }
  }
}

function addSyntaxDecorations(
  view: EditorView,
  options: LivePreviewOptions,
  ranges: Range<Decoration>[],
  from: number,
  to: number,
): void {
  const state = view.state;
  const hiddenMarks = new Set([
    'EmphasisMark',
    'StrikethroughMark',
    'CodeMark',
    'HeaderMark',
    'QuoteMark',
  ]);
  const styledParents: Record<string, string> = {
    StrongEmphasis: 'cm-md-strong',
    Emphasis: 'cm-md-emphasis',
    Strikethrough: 'cm-md-strike',
    InlineCode: 'cm-md-inline-code',
  };
  const decoratedMathBlocks = new Set<number>();

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'BlockMath') {
        addBlockMathDecoration(view, node, decoratedMathBlocks, ranges);
        return false;
      }
      const parent = parentRange(node);
      if (node.name === 'Escape' && !selectionTouches(state, node.from, node.to)) {
        ranges.push(Decoration.replace({}).range(node.from, node.from + 1));
      }
      const isCodeFence = node.name === 'CodeMark' && node.node.parent?.name === 'FencedCode';
      const cursorAtInlineEnd =
        !isCodeFence &&
        state.selection.ranges.some((range) => range.empty && range.head === parent?.to);
      if (
        hiddenMarks.has(node.name) &&
        parent &&
        !selectionTouches(
          state,
          isCodeFence ? state.doc.lineAt(parent.from).from : parent.from,
          isCodeFence ? state.doc.lineAt(parent.to).to + 1 : parent.to,
        ) &&
        !cursorAtInlineEnd
      ) {
        // The space after an opening # marker is syntax too, not heading indentation.
        const to =
          node.name === 'HeaderMark' && node.from === parent.from
            ? node.to + (state.sliceDoc(node.to, parent.to).match(/^[ \t]+/)?.[0].length ?? 0)
            : node.to;
        ranges.push(Decoration.replace({}).range(node.from, to));
        if (
          node.name === 'HeaderMark' &&
          state.doc.lineAt(node.from).number > state.doc.lineAt(parent.from).number
        ) {
          ranges.push(
            Decoration.line({ class: 'cm-md-setext-mark' }).range(state.doc.lineAt(node.from).from),
          );
        }
      }
      const parentClass = styledParents[node.name];
      if (parentClass) {
        ranges.push(Decoration.mark({ class: parentClass }).range(node.from, node.to));
      }

      if (/^(?:ATXHeading[1-6]|SetextHeading[12])$/.test(node.name)) {
        const level = node.name.slice(-1);
        const headingText = getHeadingText(state.doc, node.node, options.resolveHeadingWikiLink);
        ranges.push(
          Decoration.line({
            class: `cm-md-heading cm-md-heading-${level}`,
            attributes: {
              id: getHeadingId(headingText),
              'data-heading-level': level,
              'data-heading-text': headingText,
            },
          }).range(node.from),
        );
      } else if (node.name === 'Blockquote') {
        const firstLine = state.doc.lineAt(node.from).number;
        const lastLine = state.doc.lineAt(node.to).number;
        for (
          let lineNumber = Math.max(firstLine, state.doc.lineAt(from).number);
          lineNumber <= Math.min(lastLine, state.doc.lineAt(to).number);
          lineNumber += 1
        ) {
          const line = state.doc.line(lineNumber);
          ranges.push(Decoration.line({ class: 'cm-md-blockquote' }).range(line.from));
        }
      } else if (node.name === 'FencedCode') {
        const firstLine = state.doc.lineAt(node.from).number;
        const lastLine = state.doc.lineAt(node.to).number;
        const first = state.doc.line(firstLine);
        const block = codeBlockRange(state, node.from, node.to);
        const active = selectionTouches(state, first.from, state.doc.line(lastLine).to + 1);
        if (first.from >= from) {
          ranges.push(
            Decoration.widget({
              widget: new CopyCodeWidget(codeBlockText(state, block)),
              side: 1,
            }).range(first.to),
          );
        }
        for (
          let lineNumber = Math.max(firstLine, state.doc.lineAt(from).number);
          lineNumber <= Math.min(lastLine, state.doc.lineAt(to).number);
          lineNumber += 1
        ) {
          const line = state.doc.line(lineNumber);
          const fenceOnly =
            (lineNumber === firstLine && node.node.firstChild?.nextSibling?.name !== 'CodeInfo') ||
            (lineNumber === lastLine && block.closed);
          const compactFence = fenceOnly && !active;
          ranges.push(
            Decoration.line({
              class: `cm-md-code-block ${lineNumber === firstLine ? 'cm-md-code-block-first' : ''} ${lineNumber === lastLine ? 'cm-md-code-block-last' : ''} ${compactFence ? 'cm-md-code-fence-compact' : ''}`,
            }).range(line.from),
          );
        }
      } else if (node.name === 'HorizontalRule' && !selectionTouches(state, node.from, node.to)) {
        ranges.push(Decoration.replace({ widget: new DividerWidget() }).range(node.from, node.to));
      } else if (node.name === 'TaskMarker') {
        const checked = /x/i.test(state.sliceDoc(node.from, node.to));
        if (checked) {
          ranges.push(
            Decoration.line({ class: 'cm-md-task-checked' }).range(
              state.doc.lineAt(node.from).from,
            ),
          );
        }
        const to =
          node.to +
          (state.sliceDoc(node.to, state.doc.lineAt(node.to).to).match(/^[ \t]+/)?.[0].length ?? 0);
        ranges.push(
          Decoration.replace({
            widget: new TaskWidget(checked, node.from, node.to, state.readOnly),
          }).range(node.from, to),
        );
      } else if (node.name === 'BulletList' || node.name === 'OrderedList') {
        ranges.push(
          Decoration.line({ class: 'cm-md-list-last' }).range(state.doc.lineAt(node.to).from),
        );
      } else if (node.name === 'ListItem') {
        let depth = 1;
        let ancestor = node.node.parent;
        while (ancestor) {
          if (ancestor.name === 'ListItem') depth += 1;
          ancestor = ancestor.parent;
        }
        ranges.push(
          Decoration.line({
            class: 'cm-md-list-item',
            attributes: { style: `--cm-md-list-indent: ${depth * 1.5}rem` },
          }).range(state.doc.lineAt(node.from).from),
        );
      } else if (node.name === 'ListMark') {
        const line = state.doc.lineAt(node.from);
        const task = /^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]/.test(line.text);
        const source = state.sliceDoc(node.from, node.to).trim();
        const from = /^\s*$/.test(state.sliceDoc(line.from, node.from)) ? line.from : node.from;
        const to = node.to + (state.sliceDoc(node.to, line.to).match(/^[ \t]+/)?.[0].length ?? 0);
        ranges.push(
          Decoration.replace(
            task
              ? {}
              : {
                  widget: new ListMarkerWidget(/^\d/.test(source) ? source : '•'),
                },
          ).range(from, to),
        );
      } else if (node.name === 'InlineMath' && !selectionTouches(state, node.from, node.to)) {
        ranges.push(
          Decoration.replace({
            widget: new MathWidget(
              state.sliceDoc(node.from + 1, node.to - 1),
              false,
              { from: node.from, to: node.to },
              state.readOnly,
            ),
          }).range(node.from, node.to),
        );
      } else if (!addLinkPreviewDecoration(state, node, options, ranges)) {
        addTablePreviewDecoration(state, node, ranges);
      }
      return undefined;
    },
  });
}

export function buildLivePreviewDecorations(
  view: EditorView,
  options: LivePreviewOptions,
  from = 0,
  to = view.state.doc.length,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const expanded = expandPreviewRangeForBlockMath(view, { from, to });
  const start = expanded.from;
  const end = expanded.to;
  addTagDecorations(view, ranges, start, end);
  addSyntaxDecorations(view, options, ranges, start, end);
  // An ancestor can extend outside the requested window. Keep only decorations
  // that actually intersect it; the rest will be built when their region is shown.
  return Decoration.set(
    ranges.filter((range) => range.to >= start && range.from <= end),
    true,
  );
}
