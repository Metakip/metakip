import { syntaxTree } from '@codemirror/language';
import { type Extension, type Range, StateEffect } from '@codemirror/state';
import {
  type Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { externalLinkInteractions } from './linkInteractions';
import { trimLivePreviewCache } from './livePreviewCache';
import {
  buildLivePreviewDecorations,
  expandPreviewRangeForBlockMath,
} from './livePreviewDecorations';
import { buildTableWrappers, tableWrapperPlugin } from './livePreviewTables';
import type { LivePreviewOptions } from './livePreviewTypes';
import { scrollEdgeContinuity } from './scrollEdgeContinuity';
import { tableCaretScroll } from './tableCaretScroll';
import { tableCellInput } from './tableCellInput';
import { visualEditors } from './visualEditors';

const refreshAfterScroll = StateEffect.define<void>();

function keepWholeMathBlock(
  tree: ReturnType<typeof syntaxTree>,
  position: number,
): { from: number; to: number } | null {
  let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(position, 1);
  while (node) {
    if (node.name === 'BlockMath') return { from: node.from, to: node.to };
    node = node.parent;
  }
  return null;
}

export function livePreview(options: LivePreviewOptions = {}): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private tree: ReturnType<typeof syntaxTree>;
      private scrollTimer: number | undefined;

      constructor(readonly view: EditorView) {
        this.tree = syntaxTree(view.state);
        const region = expandPreviewRangeForBlockMath(view, {
          from: view.viewport.from,
          to: view.viewport.to,
        });
        this.decorations = buildLivePreviewDecorations(view, options, region.from, region.to);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) this.decorations = this.decorations.map(update.changes);

        const tree = syntaxTree(update.state);
        const treeChanged = tree !== this.tree;
        this.tree = tree;
        const reconfigured = update.transactions.some((transaction) => transaction.reconfigured);
        const refresh = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(refreshAfterScroll)),
        );
        if (
          !update.docChanged &&
          !update.selectionSet &&
          !reconfigured &&
          !refresh &&
          (update.viewportChanged || (this.scrollTimer !== undefined && treeChanged))
        ) {
          // Avoid changing layout during an active scroll gesture. Parsing and
          // newly visible source catch up once scrolling pauses.
          if (this.scrollTimer !== undefined) window.clearTimeout(this.scrollTimer);
          this.scrollTimer = window.setTimeout(() => {
            this.scrollTimer = undefined;
            if (this.view.dom.isConnected) {
              this.view.dispatch({ effects: refreshAfterScroll.of(undefined) });
            }
          }, 150);
          return;
        }
        if (
          !update.docChanged &&
          !update.selectionSet &&
          !update.viewportChanged &&
          !treeChanged &&
          !reconfigured &&
          !refresh
        )
          return;
        if (this.scrollTimer !== undefined) {
          window.clearTimeout(this.scrollTimer);
          this.scrollTimer = undefined;
        }

        // Rebuild only the visible lines. Preserve decorations already rendered
        // elsewhere so a selection change or scroll doesn't collapse offscreen
        // blocks and shift the browser's scroll anchor.
        const region = expandPreviewRangeForBlockMath(update.view, {
          from: update.view.viewport.from,
          to: update.view.viewport.to,
        });
        const visible = buildLivePreviewDecorations(update.view, options, region.from, region.to);
        const add: Range<Decoration>[] = [];
        visible.between(region.from, region.to, (start, end, value) => {
          add.push(value.range(start, end));
        });
        const { doc } = update.state;
        this.decorations = this.decorations.update({
          filterFrom: region.from,
          filterTo: region.to + 1,
          filter: (start, end) => end < region.from || start > region.to,
          add,
          sort: true,
        });
        this.decorations = trimLivePreviewCache(this.decorations, doc.length, region, (position) =>
          keepWholeMathBlock(tree, position),
        );
      }

      destroy(): void {
        if (this.scrollTimer !== undefined) window.clearTimeout(this.scrollTimer);
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [
    visualEditors,
    externalLinkInteractions,
    tableCellInput,
    plugin,
    tableWrapperPlugin,
    EditorView.blockWrappers.of(buildTableWrappers),
    tableCaretScroll,
    scrollEdgeContinuity,
  ];
}
