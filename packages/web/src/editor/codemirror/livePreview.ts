import type { Extension } from '@codemirror/state';
import { type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { externalLinkInteractions } from './linkInteractions';
import { buildLivePreviewDecorations } from './livePreviewDecorations';
import { buildTableWrappers } from './livePreviewTables';
import type { LivePreviewOptions } from './livePreviewTypes';
import { visualEditors } from './visualEditors';

export function livePreview(options: LivePreviewOptions = {}): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(readonly view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view, options);
      }

      update(update: ViewUpdate): void {
        // Decorations are document/selection state, not viewport state. Rebuilding them during
        // a hard scroll can change block measurements as CodeMirror expands its parse viewport,
        // which makes the browser scroll anchor jump.
        if (
          update.docChanged ||
          update.selectionSet ||
          update.transactions.some((transaction) => transaction.reconfigured)
        ) {
          this.decorations = buildLivePreviewDecorations(update.view, options);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [
    visualEditors,
    externalLinkInteractions,
    plugin,
    EditorView.blockWrappers.of(buildTableWrappers),
  ];
}
