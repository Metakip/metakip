import { language, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import {
  type ChangeDesc,
  type EditorState,
  type Range,
  RangeSet,
  RangeValue,
  StateField,
} from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { codeBlockInfo, codeBlockRange, codeBlockText, codePrefixLength } from './codeBlocks';
import { selectionTouches } from './livePreviewTypes';
import {
  MAX_DIAGRAM_SOURCE_LENGTH,
  mermaidErrorMessage,
  renderMermaidSvg,
} from './mermaidRenderer';

type MermaidTreeNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

type MermaidPreviewState = {
  tree: ReturnType<typeof syntaxTree>;
  // Furthest known parsed prefix. Unchanged blocks beyond the parser's current
  // frontier remain valid after a local edit and need not be scanned again.
  parsedTo: number;
  blocks: RangeSet<MermaidBlock>;
  decorations: ReturnType<typeof Decoration.set>;
  selectionIsIntentional: boolean;
};

// A block keeps its render identity across position changes and source-reveal
// cycles. Bound the cache per editor; a WeakMap keyed by block would still
// retain every SVG in a long document because the block index holds the keys.
const MAX_CACHED_DIAGRAMS = 8;

export const mermaidRenderCachePlugin = ViewPlugin.fromClass(
  class {
    readonly renderedDiagrams = new Map<object, Promise<SVGSVGElement>>();

    render(block: MermaidBlock): Promise<SVGSVGElement> {
      let rendered = this.renderedDiagrams.get(block.renderKey);
      if (rendered) this.renderedDiagrams.delete(block.renderKey);
      else {
        rendered = renderMermaidSvg(block.source);
        const pending = rendered;
        void pending.catch(() => {
          // A failed lazy import or render may be transient. Do not pin its rejection.
          if (this.renderedDiagrams.get(block.renderKey) === pending)
            this.renderedDiagrams.delete(block.renderKey);
        });
      }
      this.renderedDiagrams.set(block.renderKey, rendered);
      if (this.renderedDiagrams.size > MAX_CACHED_DIAGRAMS) {
        const oldest = this.renderedDiagrams.keys().next().value;
        if (oldest) this.renderedDiagrams.delete(oldest);
      }
      return rendered;
    }

    destroy(): void {
      this.renderedDiagrams.clear();
    }
  },
);

class MermaidBlock extends RangeValue {
  constructor(
    readonly source: string,
    readonly bodyOffset: number,
    readonly bodyEndOffset: number,
    readonly contentOffset: number,
    readonly prefix: string,
    readonly renderKey: object,
  ) {
    super();
  }

  eq(other: RangeValue): boolean {
    return (
      other instanceof MermaidBlock &&
      other.source === this.source &&
      other.bodyOffset === this.bodyOffset &&
      other.bodyEndOffset === this.bodyEndOffset &&
      other.contentOffset === this.contentOffset &&
      other.prefix === this.prefix &&
      other.renderKey === this.renderKey
    );
  }
}

type SourceRange = { from: number; to: number };

function parsedThrough(state: EditorState): number {
  let from = 0;
  let to = state.doc.length;
  while (from < to) {
    const middle = Math.ceil((from + to) / 2);
    if (syntaxTreeAvailable(state, middle)) from = middle;
    else to = middle - 1;
  }
  return from;
}

function mergeRanges(ranges: SourceRange[]): SourceRange[] {
  ranges.sort((left, right) => left.from - right.from);
  const merged: SourceRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/** Block replacements must be provided by a state field, not a view plugin.
 * Keep the source and the widget in one range so viewport clipping cannot
 * leave a diagram with half of its Markdown still visible. */
export const mermaidPreviewField = StateField.define<MermaidPreviewState>({
  create(state) {
    const tree = syntaxTree(state);
    const parsedTo = parsedThrough(state);
    const blocks = RangeSet.of(collectMermaidBlocks(state, tree, 0, parsedTo), true);
    // A read-only editor starts with a passive caret at 0, not a source reveal.
    const selectionIsIntentional = !state.readOnly;
    const decorations = Decoration.set(
      decorationsInRange(state, blocks, { from: 0, to: state.doc.length }, selectionIsIntentional),
      true,
    );
    return { tree, parsedTo, blocks, decorations, selectionIsIntentional };
  },
  update(previous, transaction) {
    const { state, changes } = transaction;
    const tree = syntaxTree(state);
    const languageChanged = state.facet(language) !== transaction.startState.facet(language);
    const readOnlyChanged = state.readOnly !== transaction.startState.readOnly;
    const selectionIsIntentional =
      previous.selectionIsIntentional || !!transaction.selection || !state.readOnly;
    if (
      tree === previous.tree &&
      !transaction.docChanged &&
      !transaction.selection &&
      !languageChanged &&
      !readOnlyChanged
    )
      return previous;
    const parsedTo = parsedThrough(state);
    const parserReset =
      languageChanged ||
      (!transaction.docChanged && tree !== previous.tree && parsedTo < previous.parsedTo);
    let blocks = parserReset
      ? RangeSet.empty
      : transaction.docChanged
        ? previous.blocks.map(changes)
        : previous.blocks;
    let decorations = parserReset
      ? Decoration.set([])
      : transaction.docChanged
        ? previous.decorations.map(changes)
        : previous.decorations;
    const mappedParsedTo = changes.mapPos(previous.parsedTo);
    const edits =
      transaction.docChanged && !parserReset
        ? changedRanges(transaction.startState, state, previous.tree, tree, changes)
        : { ranges: [], structuralFrom: null };
    const changed = edits.ranges;
    if (parserReset) changed.push({ from: 0, to: parsedTo });
    // A structural edit can change the interpretation of everything after an
    // unfinished parse. Discard that tail rather than preserving stale widgets.
    const staleTailFrom = parsedTo < mappedParsedTo ? edits.structuralFrom : null;
    if (staleTailFrom !== null) changed.push({ from: staleTailFrom, to: mappedParsedTo });
    if (
      tree !== previous.tree &&
      !transaction.docChanged &&
      !parserReset &&
      parsedTo > previous.parsedTo
    )
      changed.push({ from: previous.parsedTo, to: parsedTo });

    for (const region of mergeRanges(changed)) {
      blocks = blocks.update({
        filterFrom: region.from,
        filterTo: region.to + 1,
        filter: (from, to) => to < region.from || from > region.to,
        add: collectMermaidBlocks(state, tree, region.from, region.to, blocks),
        sort: true,
      });
    }

    const refresh = [...changed];
    if (transaction.selection || transaction.docChanged) {
      const oldSelection = transaction.startState.selection.map(changes);
      for (const selection of [...oldSelection.ranges, ...state.selection.ranges]) {
        blocks.between(selection.from, Math.min(state.doc.length, selection.to + 1), (from, to) => {
          refresh.push({ from, to });
        });
      }
    }
    if (readOnlyChanged) refresh.push({ from: 0, to: state.doc.length });
    for (const region of mergeRanges(refresh)) {
      decorations = decorations.update({
        filterFrom: region.from,
        filterTo: region.to + 1,
        filter: (from, to) => to < region.from || from > region.to,
        add: decorationsInRange(state, blocks, region, selectionIsIntentional),
        sort: true,
      });
    }
    return {
      tree,
      parsedTo:
        parserReset || staleTailFrom !== null ? parsedTo : Math.max(parsedTo, mappedParsedTo),
      blocks,
      decorations,
      selectionIsIntentional,
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** When the same leaf block survives the edit, only that block can change.
 * Structural edits use the affected list item when it survives, otherwise
 * fall back to the enclosing top-level Markdown block. */
function stableLeafBlock(
  tree: ReturnType<typeof syntaxTree>,
  from: number,
  to: number,
): (SourceRange & { name: string }) | null {
  let node: MermaidTreeNode | null = tree.resolveInner(from, 1);
  while (node) {
    if (
      (node.name === 'FencedCode' || node.name === 'Paragraph') &&
      node.from <= from &&
      node.to >= to
    )
      return { from: node.from, to: node.to, name: node.name };
    node = node.parent;
  }
  return null;
}

function enclosingListItem(
  tree: ReturnType<typeof syntaxTree>,
  from: number,
  to: number,
): SourceRange | null {
  let node: MermaidTreeNode | null = tree.resolveInner(from, 1);
  while (node) {
    if (node.name === 'ListItem' && node.from <= from && node.to >= to)
      return { from: node.from, to: node.to };
    node = node.parent;
  }
  return null;
}

function changedTopLevelBlock(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  from: number,
  to: number,
): { from: number; to: number } {
  const start = state.doc.lineAt(from).from;
  const end = state.doc.lineAt(to).to;
  let blockFrom = start;
  let blockTo = end;
  tree.iterate({
    from: start,
    to: end,
    enter(node) {
      if (node.node.parent?.parent !== null) return undefined;
      blockFrom = Math.min(blockFrom, node.from);
      blockTo = Math.max(blockTo, node.to);
      return false;
    },
  });
  return { from: blockFrom, to: blockTo };
}

function changedRanges(
  oldState: EditorState,
  state: EditorState,
  oldTree: ReturnType<typeof syntaxTree>,
  tree: ReturnType<typeof syntaxTree>,
  changes: ChangeDesc,
): { ranges: SourceRange[]; structuralFrom: number | null } {
  const ranges: SourceRange[] = [];
  let structuralFrom: number | null = null;
  changes.iterChangedRanges((oldFrom, oldTo, newFrom, newTo) => {
    const oldLeaf = stableLeafBlock(oldTree, oldFrom, oldTo);
    const newLeaf = stableLeafBlock(tree, newFrom, newTo);
    const stable =
      oldLeaf !== null &&
      newLeaf !== null &&
      oldLeaf.name === newLeaf.name &&
      changes.mapPos(oldLeaf.from, -1) === newLeaf.from &&
      changes.mapPos(oldLeaf.to, 1) === newLeaf.to;
    // A structural edit within a list item need not invalidate every sibling
    // in a potentially enormous top-level list. The union of its old and new
    // extent also covers an item split or a fence that absorbs later items.
    const oldItem = stable ? null : enclosingListItem(oldTree, oldFrom, oldTo);
    const newItem = stable ? null : enclosingListItem(tree, newFrom, newTo);
    const sameItem =
      oldItem !== null && newItem !== null && changes.mapPos(oldItem.from, -1) === newItem.from;
    const oldBlock = stable
      ? oldLeaf
      : sameItem
        ? oldItem
        : changedTopLevelBlock(oldState, oldTree, oldFrom, oldTo);
    const newBlock = stable
      ? newLeaf
      : sameItem
        ? newItem
        : changedTopLevelBlock(state, tree, newFrom, newTo);
    const affected = {
      from: Math.min(changes.mapPos(oldBlock.from, -1), newBlock.from),
      to: Math.max(changes.mapPos(oldBlock.to, 1), newBlock.to),
    };
    if (!stable)
      structuralFrom =
        structuralFrom === null ? affected.from : Math.min(structuralFrom, affected.from);
    ranges.push(affected);
  });
  return { ranges, structuralFrom };
}

function collectMermaidBlocks(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  from: number,
  to: number,
  previous: RangeSet<MermaidBlock> = RangeSet.empty,
): Range<MermaidBlock>[] {
  const blocks: Range<MermaidBlock>[] = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'FencedCode') return undefined;
      if (
        codeBlockInfo(state, node.node)?.language !== 'mermaid' ||
        node.to - node.from > MAX_DIAGRAM_SOURCE_LENGTH
      )
        return false;
      const block = codeBlockRange(state, node.node);
      if (
        !block.closed ||
        state.doc.lineAt(node.to).number <= state.doc.lineAt(node.from).number + 1
      )
        return false;
      const source = codeBlockText(state, block);
      if (!source.trim()) return false;
      const first = state.doc.lineAt(block.from).number + 1;
      const last = state.doc.lineAt(block.to).number;
      const bodyFrom = state.doc.line(first).from;
      let contentOffset = 0;
      for (let lineNumber = first; lineNumber < last; lineNumber += 1) {
        const line = state.doc.line(lineNumber);
        const prefixLength = codePrefixLength(line.text, block.prefix);
        if (line.text.slice(prefixLength).trim()) {
          contentOffset = line.from + prefixLength - bodyFrom;
          break;
        }
      }
      const blockFrom = state.doc.lineAt(block.from).from;
      const cursor = previous.iter(blockFrom);
      while (cursor.value && cursor.from < blockFrom) cursor.next();
      const prior = cursor.from === blockFrom ? cursor.value : null;
      blocks.push(
        new MermaidBlock(
          source,
          bodyFrom - blockFrom,
          state.doc.line(last).from - blockFrom,
          contentOffset,
          block.prefix,
          prior?.source === source ? prior.renderKey : {},
        ).range(blockFrom, state.doc.line(last).to),
      );
      return false;
    },
  });
  return blocks;
}

function decorationsInRange(
  state: EditorState,
  blocks: RangeSet<MermaidBlock>,
  region: SourceRange,
  selectionIsIntentional: boolean,
): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  blocks.between(region.from, region.to, (from, to, block) => {
    if (selectionIsIntentional && selectionTouches(state, from, to + 1)) return;
    ranges.push(
      Decoration.replace({
        block: true,
        widget: new MermaidDiagramWidget(block, state.readOnly),
      }).range(from + block.bodyOffset, from + block.bodyEndOffset),
    );
  });
  return ranges;
}

class MermaidDiagramWidget extends WidgetType {
  constructor(
    readonly block: MermaidBlock,
    readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: MermaidDiagramWidget): boolean {
    return (
      other.block.source === this.block.source &&
      other.block.contentOffset === this.block.contentOffset &&
      other.block.prefix === this.block.prefix &&
      other.readOnly === this.readOnly
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('div');
    element.className = 'cm-md-mermaid-widget';
    if (this.block.prefix.includes('>')) element.classList.add('cm-md-blockquote');
    const trailing = this.block.prefix.slice(this.block.prefix.lastIndexOf('>') + 1);
    const indent = (this.block.prefix.includes('>') ? trailing.replace(/^[ \t]/, '') : trailing)
      .length;
    if (indent) element.style.marginLeft = `${indent}ch`;
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    const action = this.readOnly ? 'reveal' : 'edit';
    element.setAttribute('aria-label', `Mermaid diagram. Activate to ${action} its source.`);
    element.title = `Click to ${action} Mermaid source`;

    const loading = document.createElement('span');
    loading.className = 'cm-md-mermaid-status';
    loading.textContent = 'Rendering diagram…';
    element.append(loading);

    const revealSource = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        selection: { anchor: view.posAtDOM(element, 0) + this.block.contentOffset },
        scrollIntoView: true,
      });
      view.focus();
    };
    element.addEventListener('mousedown', (event) => {
      if (event.button === 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    element.addEventListener('click', revealSource);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') revealSource(event);
    });

    const cache = view.plugin(mermaidRenderCachePlugin);
    if (!cache) throw new Error('Mermaid render cache is not installed');
    void cache
      .render(this.block)
      .then((svg) => {
        if (!element.isConnected) return;
        svg.setAttribute('aria-hidden', 'true');
        element.replaceChildren(svg.cloneNode(true));
        view.requestMeasure();
      })
      .catch((error: unknown) => {
        if (!element.isConnected) return;
        const message = mermaidErrorMessage(error);
        const label = document.createElement('span');
        label.className = 'cm-md-mermaid-error-label';
        label.textContent = 'Unable to render Mermaid diagram';
        const details = document.createElement('span');
        details.className = 'cm-md-mermaid-error-details';
        details.textContent = message;
        element.classList.add('cm-md-mermaid-error');
        element.setAttribute(
          'aria-label',
          `Mermaid rendering error: ${message}. Activate to ${action} its source.`,
        );
        element.replaceChildren(label, details);
        view.requestMeasure();
      });

    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}
