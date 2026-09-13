import type { EditorState, Range } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { parseWikiLinkTarget } from '@metakip/shared';
import { ensureAbsoluteUrl } from '../../utils/url';
import { type LivePreviewOptions, type PreviewNodeRef, selectionTouches } from './livePreviewTypes';
import { ImageWidget, WikiLinkWidget } from './livePreviewWidgets';

function linkAttributes(href: string, from: number): Record<string, string> {
  return {
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    'data-md-link-from': String(from),
  };
}

function autolinkHref(label: string): string {
  return ensureAbsoluteUrl(/^[^\s@:/]+@[^\s@/]+$/.test(label) ? `mailto:${label}` : label);
}

/** Add link and image preview decorations. Returns true when the node was handled. */
export function addLinkPreviewDecoration(
  state: EditorState,
  node: PreviewNodeRef,
  options: LivePreviewOptions,
  ranges: Range<Decoration>[],
): boolean {
  if (node.name === 'WikiLink' && !selectionTouches(state, node.from, node.to)) {
    const parsed = parseWikiLinkTarget(state.sliceDoc(node.from + 2, node.to - 2));
    if (!parsed) return true;
    ranges.push(
      Decoration.replace({
        widget: new WikiLinkWidget(
          parsed.page,
          parsed.targetId,
          parsed.alias,
          parsed.heading,
          node.from,
          options.onWikiLinkClick,
          options.onWikiLinkResolved,
        ),
      }).range(node.from, node.to),
    );
    return true;
  }
  if (node.name === 'Image' && !selectionTouches(state, node.from, node.to)) {
    const raw = state.sliceDoc(node.from, node.to);
    const match = raw.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+["'].*["'])?\)$/);
    if (match?.[2]) {
      ranges.push(
        Decoration.replace({
          widget: new ImageWidget(match[2], match[1] ?? '', node.from),
        }).range(node.from, node.to),
      );
    }
    return true;
  }
  if (node.name === 'Link' && !selectionTouches(state, node.from, node.to)) {
    let child = node.node.firstChild;
    let href = '';
    let labelEnd = node.to;
    while (child) {
      if (child.name === 'LinkMark' && state.sliceDoc(child.from, child.to) === ']')
        labelEnd = child.from;
      if (child.name === 'URL') {
        href = state.sliceDoc(child.from, child.to);
        if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
      }
      child = child.nextSibling;
    }
    if (node.node.firstChild)
      ranges.push(Decoration.replace({}).range(node.from, node.node.firstChild.to));
    if (labelEnd < node.to) ranges.push(Decoration.replace({}).range(labelEnd, node.to));
    const safeHref = ensureAbsoluteUrl(href);
    ranges.push(
      Decoration.mark(
        safeHref
          ? {
              tagName: 'a',
              class: 'cm-md-link',
              attributes: linkAttributes(safeHref, node.from),
            }
          : { class: 'cm-md-unsafe-link' },
      ).range(node.from, node.to),
    );
    return true;
  }
  if (node.name === 'Autolink' && !selectionTouches(state, node.from, node.to)) {
    ranges.push(Decoration.replace({}).range(node.from, node.from + 1));
    ranges.push(Decoration.replace({}).range(node.to - 1, node.to));
    const label = state.sliceDoc(node.from + 1, node.to - 1);
    const href = autolinkHref(label);
    ranges.push(
      Decoration.mark(
        href
          ? {
              tagName: 'a',
              class: 'cm-md-link',
              attributes: linkAttributes(href, node.from),
            }
          : { class: 'cm-md-unsafe-link' },
      ).range(node.from + 1, node.to - 1),
    );
    return true;
  }
  if (node.name !== 'URL') return false;
  if (node.node.parent?.name === 'Paragraph') {
    const label = state.sliceDoc(node.from, node.to);
    const href = autolinkHref(label);
    ranges.push(
      Decoration.mark(
        href
          ? {
              tagName: 'a',
              class: 'cm-md-link',
              attributes: linkAttributes(href, node.from),
            }
          : { class: 'cm-md-unsafe-link' },
      ).range(node.from, node.to),
    );
  }
  return true;
}
