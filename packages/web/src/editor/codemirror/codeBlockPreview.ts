import type { EditorState, Range } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { codeBlockInfo, codeBlockRange, codeBlockText } from './codeBlocks';
import type { PreviewNodeRef } from './livePreviewTypes';
import { selectionTouches } from './livePreviewTypes';
import { CopyCodeWidget } from './livePreviewWidgets';

/** Render normal fence controls and lines. The Mermaid state field replaces its
 * inactive body and styles the closing line; decorations inside it are hidden. */
export function addCodeBlockPreview(
  state: EditorState,
  node: PreviewNodeRef,
  ranges: Range<Decoration>[],
  from: number,
  to: number,
): void {
  const firstLine = state.doc.lineAt(node.from).number;
  const lastLine = state.doc.lineAt(node.to).number;
  const first = state.doc.line(firstLine);
  const block = codeBlockRange(state, node.node);
  const active = selectionTouches(state, first.from, state.doc.line(lastLine).to + 1);
  const codeInfo = codeBlockInfo(state, node.node);
  if (codeInfo?.language === 'mermaid') {
    ranges.push(
      Decoration.mark({ class: 'cm-md-mermaid-language' }).range(codeInfo.from, codeInfo.to),
    );
  }
  if (first.from >= from) {
    ranges.push(
      Decoration.widget({ widget: new CopyCodeWidget(codeBlockText(state, block)), side: 1 }).range(
        first.to,
      ),
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
}
