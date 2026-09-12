import { Prec } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { LinkEditor } from '../components/LinkEditor';
import { MathEditor } from '../components/MathEditor';
import {
  linkMarkdown,
  removedLinkText,
  type VisualEditorTarget,
  visualEditorTarget,
} from './visualEditorTargets';

function eventTarget(event: Event, view: EditorView, selector: string) {
  const element =
    event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
  if (!element || !view.contentDOM.contains(element)) return null;
  const position = Number(element.dataset.mdLinkFrom ?? element.dataset.mdMathFrom);
  if (!Number.isInteger(position) || position < 0 || position > view.state.doc.length) return null;
  const target = visualEditorTarget(view.state, position);
  return target ? { element, target } : null;
}

// The existing Milkdown components only need an anchor, focus(), and callbacks.
// This adapter translates those callbacks into Markdown document changes.
export const visualEditors = Prec.highest(
  ViewPlugin.fromClass(
    class {
      private link = new LinkEditor();
      private math = new MathEditor();
      private target: VisualEditorTarget | null = null;

      constructor(private view: EditorView) {}

      update(update: ViewUpdate): void {
        if (update.state.readOnly) this.close();
        const target = this.target;
        if (!target || !update.docChanged) return;
        const from = update.changes.mapPos(target.from, 1);
        const to = update.changes.mapPos(target.to, -1);
        if (from > to || update.state.sliceDoc(from, to) !== target.source) this.close();
        else Object.assign(target, { from, to });
      }

      close(): void {
        this.target = null;
        this.link.close();
        this.math.close();
      }

      destroy(): void {
        this.close();
      }

      private replace(target: VisualEditorTarget, insert: string): void {
        if (this.view.state.readOnly || this.target !== target) return;
        this.close();
        if (insert === target.source) return;
        this.view.dispatch({
          changes: { from: target.from, to: target.to, insert },
          selection: { anchor: target.from + insert.length },
          userEvent: 'input',
          scrollIntoView: true,
        });
      }

      mouseover(event: MouseEvent): boolean {
        if (this.view.state.readOnly) return false;
        const hit = eventTarget(event, this.view, 'a.cm-md-link');
        if (!hit || hit.target.kind !== 'link') return false;
        if (event.relatedTarget instanceof Node && hit.element.contains(event.relatedTarget))
          return false;
        this.close();
        const { target, element } = hit;
        if (target.kind !== 'link') return false;
        this.target = target;
        this.link.open(this.view, element, {
          initialUrl: target.url,
          initialText: target.text,
          onConfirm: ({ url, text }) => this.replace(target, linkMarkdown(target, text, url)),
          onRemove: () => this.replace(target, removedLinkText(target)),
        });
        return false;
      }

      click(event: MouseEvent | KeyboardEvent): boolean {
        if (('button' in event && event.button !== 0) || event.shiftKey) return false;
        const hit = eventTarget(event, this.view, '.cm-md-math');
        if (!hit || hit.target.kind !== 'math') {
          if (eventTarget(event, this.view, 'a.cm-md-link')) this.close();
          return false;
        }
        event.preventDefault();
        if (this.view.state.readOnly) return true;
        this.close();
        const { target, element } = hit;
        if (target.kind !== 'math') return false;
        this.target = target;
        this.math.open(this.view, element, {
          initialValue: target.value,
          displayMode: target.block ? 'block' : 'inline',
          onConfirm: (value) =>
            this.replace(
              target,
              target.source.slice(0, target.contentFrom) +
                value +
                target.source.slice(target.contentTo),
            ),
          onCancel: () => {},
        });
        return true;
      }
    },
    {
      eventHandlers: {
        mouseover(event) {
          return this.mouseover(event);
        },
        click(event) {
          return this.click(event);
        },
        keydown(event, view) {
          return event.key === 'Enter' && eventTarget(event, view, '.cm-md-math')
            ? this.click(event)
            : false;
        },
        mousedown(event, view) {
          if (event.button !== 0 || event.shiftKey || !eventTarget(event, view, '.cm-md-math'))
            return false;
          event.preventDefault();
          return true;
        },
      },
    },
  ),
);
