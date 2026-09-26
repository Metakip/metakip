import type { Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

// CodeMirror estimates the height of unmounted lines. When the page rather
// than cm-scroller owns scrolling, its built-in height correction is limited
// for unfocused editors. Keep an endpoint reached by a recent scroll gesture
// attached until the user scrolls away from that endpoint.
const EDGE_TOLERANCE = 2;

export const scrollEdgeContinuity: Extension = ViewPlugin.fromClass(
  class {
    private scroller: HTMLElement | null = null;
    private edge: 'top' | 'bottom' | null = null;
    private lastTop = 0;
    private correctedAt = 0;

    constructor(readonly view: EditorView) {
      view.dom.ownerDocument.addEventListener('scroll', this.onScroll, true);
    }

    private onScroll = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.contains(this.view.dom)) return;
      const max = target.scrollHeight - target.clientHeight;
      if (max <= 0) return;
      const top = target.scrollTop;
      const previous = this.scroller === target ? this.lastTop : top;
      const correctionEvent =
        Date.now() - this.correctedAt < 50 && Math.abs(top - previous) <= EDGE_TOLERANCE;
      this.scroller = target;
      this.lastTop = top;

      // While editing, CodeMirror owns caret visibility and scroll anchoring.
      // Its programmatic scrolls must not be mistaken for a user edge fling.
      if (this.view.hasFocus) {
        this.edge = null;
        return;
      }

      // The scroll event from our own correction arrives asynchronously. It
      // must not extend the pin or be mistaken for a new user gesture.
      if (correctionEvent) return;
      if (top >= max - EDGE_TOLERANCE && top >= previous) {
        this.edge = 'bottom';
        this.measure();
      } else if (top <= EDGE_TOLERANCE && top <= previous) {
        this.edge = 'top';
        this.measure();
      } else if (
        (this.edge === 'bottom' && top < previous - EDGE_TOLERANCE) ||
        (this.edge === 'top' && top > previous + EDGE_TOLERANCE)
      ) {
        this.edge = null;
      }
    };

    private measure(): void {
      if (!this.scroller || !this.edge) return;
      const scroller = this.scroller;
      this.view.requestMeasure({
        key: this,
        read: () => ({
          top: scroller.scrollTop,
          max: scroller.scrollHeight - scroller.clientHeight,
        }),
        write: ({ top, max }) => {
          if (this.scroller !== scroller || !this.edge) return;
          const destination = this.edge === 'bottom' ? max : 0;
          if (Math.abs(top - destination) > EDGE_TOLERANCE) {
            this.correctedAt = Date.now();
            scroller.scrollTo({ top: destination, behavior: 'instant' });
            this.lastTop = destination;
          }
        },
      });
    }

    update(update: ViewUpdate): void {
      if (update.docChanged && this.view.hasFocus) {
        this.edge = null;
        return;
      }
      if (update.heightChanged) this.measure();
    }

    destroy(): void {
      this.view.dom.ownerDocument.removeEventListener('scroll', this.onScroll, true);
    }
  },
);
