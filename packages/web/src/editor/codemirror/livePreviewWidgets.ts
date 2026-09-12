import { type EditorView, WidgetType } from '@codemirror/view';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {
  subscribeToWikiLinkPresentation,
  type WikiLinkNavigationTarget,
  type WikiLinkReference,
} from '../wikiLinkPresentations';

export class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
    readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: TaskWidget): boolean {
    return (
      other.checked === this.checked &&
      other.from === this.from &&
      other.to === this.to &&
      other.readOnly === this.readOnly
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.disabled = this.readOnly;
    input.className = 'cm-md-task-checkbox';
    input.setAttribute('aria-label', this.checked ? 'Mark task incomplete' : 'Mark task complete');
    input.addEventListener('change', () => {
      if (view.state.readOnly) return;
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' },
      });
      view.focus();
    });
    return input;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class MathWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly displayMode = false,
    readonly range?: { from: number; to: number },
    readonly readOnly = false,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return (
      other.source === this.source &&
      other.displayMode === this.displayMode &&
      other.range?.from === this.range?.from &&
      other.range?.to === this.range?.to &&
      other.readOnly === this.readOnly
    );
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-md-math';
    try {
      katex.render(this.source, element, {
        throwOnError: false,
        strict: false,
        displayMode: this.displayMode,
      });
    } catch {
      element.textContent = this.source;
    }
    if (this.displayMode) element.classList.add('cm-md-math-block');
    if (this.range) {
      element.dataset.mdMathFrom = String(this.range.from);
      if (!this.readOnly) {
        element.tabIndex = 0;
        element.setAttribute('role', 'button');
        element.setAttribute('aria-label', `Edit equation: ${this.source}`);
        element.title = 'Click to edit equation';
      }
    }
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class DividerWidget extends WidgetType {
  toDOM(): HTMLElement {
    const divider = document.createElement('hr');
    divider.className = 'cm-md-divider';
    return divider;
  }
}

export class CopyCodeWidget extends WidgetType {
  private readonly timers = new WeakMap<HTMLElement, number>();
  private readonly disposed = new WeakSet<HTMLElement>();

  constructor(readonly source: string) {
    super();
  }

  eq(other: CopyCodeWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-md-code-copy';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.append(path);
    button.append(svg);
    const updateIcon = (label: string) => {
      path.setAttribute(
        'd',
        label === 'Copied'
          ? 'm5 12 4 4L19 6'
          : label === 'Copy failed'
            ? 'm6 6 12 12M18 6 6 18'
            : 'M8 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3M10 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
      );
      button.setAttribute('aria-label', label);
      button.title = label;
    };
    updateIcon('Copy code');
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', async () => {
      window.clearTimeout(this.timers.get(button));
      button.disabled = true;
      let label = 'Copied';
      try {
        await navigator.clipboard.writeText(this.source);
      } catch {
        label = 'Copy failed';
      }
      if (this.disposed.has(button)) return;
      button.disabled = false;
      updateIcon(label);
      this.timers.set(
        button,
        window.setTimeout(() => {
          updateIcon('Copy code');
        }, 1500),
      );
    });
    return button;
  }

  ignoreEvent(): boolean {
    return true;
  }

  destroy(dom: HTMLElement): void {
    this.disposed.add(dom);
    window.clearTimeout(this.timers.get(dom));
  }
}

export class EmptyTableCellWidget extends WidgetType {
  constructor(
    readonly position: number,
    readonly alignmentClass: string,
  ) {
    super();
  }

  eq(other: EmptyTableCellWidget): boolean {
    return other.position === this.position && other.alignmentClass === this.alignmentClass;
  }

  toDOM(view: EditorView): HTMLElement {
    const cell = document.createElement('span');
    cell.className = `cm-md-table-cell cm-md-table-empty-cell ${this.alignmentClass}`.trim();
    cell.textContent = '\u00a0';
    cell.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: this.position } });
      view.focus();
    });
    return cell;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class ListMarkerWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }

  eq(other: ListMarkerWidget): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = 'cm-md-list-marker';
    marker.textContent = this.label;
    return marker;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly alt: string,
    readonly position: number,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      other.source === this.source && other.alt === this.alt && other.position === this.position
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const image = document.createElement('img');
    image.className = 'cm-md-image';
    image.src = this.source;
    image.alt = this.alt;
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('load', () => view.requestMeasure());
    image.addEventListener('error', () => view.requestMeasure());
    image.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: this.position } });
      view.focus();
    });
    return image;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class WikiLinkWidget extends WidgetType {
  private readonly subscriptions = new WeakMap<HTMLElement, () => void>();

  constructor(
    readonly target: string,
    readonly targetId: string | null,
    readonly alias: string,
    readonly heading: string,
    readonly from: number,
    readonly onClick?: ((target: WikiLinkNavigationTarget) => void) | undefined,
    readonly onResolved?: ((reference: WikiLinkReference, title: string) => void) | undefined,
  ) {
    super();
  }

  eq(other: WikiLinkWidget): boolean {
    return (
      other.target === this.target &&
      other.targetId === this.targetId &&
      other.alias === this.alias &&
      other.heading === this.heading &&
      other.from === this.from &&
      other.onClick === this.onClick &&
      other.onResolved === this.onResolved
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-md-wiki-link';
    element.textContent = 'Loading…';
    let navigationTarget: WikiLinkNavigationTarget | null = null;
    const unsubscribe = subscribeToWikiLinkPresentation(
      view,
      this.targetId ? { targetId: this.targetId } : { path: this.target },
      (presentation) => {
        navigationTarget = null;
        element.removeAttribute('role');
        element.removeAttribute('tabindex');
        element.removeAttribute('title');
        element.classList.toggle('cm-md-wiki-link-restricted', presentation.state === 'restricted');
        if (presentation.state === 'accessible') {
          this.onResolved?.(
            this.targetId ? { targetId: this.targetId } : { path: this.target },
            presentation.target.title,
          );
          navigationTarget = {
            ...presentation.target,
            ...(this.heading ? { heading: this.heading } : {}),
          };
          element.textContent = this.alias || presentation.target.title;
          element.setAttribute('role', 'link');
          element.tabIndex = 0;
        } else {
          element.textContent =
            presentation.state === 'restricted'
              ? 'Restricted page'
              : presentation.state === 'loading'
                ? 'Loading…'
                : 'Unavailable page';
        }
        view.requestMeasure();
      },
    );
    this.subscriptions.set(element, unsubscribe);
    const activate = () => {
      if (navigationTarget && this.onClick) {
        this.onClick(navigationTarget);
      }
    };
    element.addEventListener('mousedown', (event) => {
      if (event.button === 0 && !event.shiftKey) event.preventDefault();
    });
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button === 0 && !event.shiftKey) activate();
    });
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      activate();
    });
    return element;
  }

  destroy(dom: HTMLElement): void {
    this.subscriptions.get(dom)?.();
  }

  ignoreEvent(): boolean {
    return true;
  }
}
