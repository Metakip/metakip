import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureAbsoluteUrl } from '../../utils/url';

function linkAtEvent(event: Event, view: EditorView): HTMLAnchorElement | null {
  const link =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a.cm-md-link')
      : null;
  return link && view.contentDOM.contains(link) ? link : null;
}

function activateLink(link: HTMLAnchorElement, view: EditorView): void {
  const href = ensureAbsoluteUrl(link.getAttribute('href') ?? '');
  if (!href) return;
  if (href.startsWith('#')) {
    const headingId = href.slice(1);
    const heading = [...view.dom.querySelectorAll<HTMLElement>('.cm-md-heading')].find(
      (element) => element.id === headingId,
    );
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}

export const externalLinkInteractions = Prec.highest(
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || event.shiftKey || !linkAtEvent(event, view)) return false;
      // Don't move the caret and replace the preview with source before click fires.
      event.preventDefault();
      return true;
    },
    click(event, view) {
      const link = linkAtEvent(event, view);
      if (!link || event.button !== 0) return false;
      event.preventDefault();
      // Shift-click remains a text-selection gesture, not navigation.
      if (!event.shiftKey) activateLink(link, view);
      return true;
    },
    keydown(event, view) {
      const link = linkAtEvent(event, view);
      if (!link || event.key !== 'Enter') return false;
      event.preventDefault();
      activateLink(link, view);
      return true;
    },
  }),
);
