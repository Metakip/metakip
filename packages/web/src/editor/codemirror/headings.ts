import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type ParsedWikiLinkTarget, parseWikiLinkTarget } from '@metakip/shared';
import { getHeadingId } from '../../utils/headingNavigation';
import {
  type HeadingSyntax,
  type HeadingSyntaxNode,
  parseEditorHeadingSyntax,
} from './headingSyntax';

export type EditorHeading = {
  id: string;
  text: string;
  level: number;
  from: number;
};

type SourceRange = { from: number; to: number };
type SourcePart = SourceRange & { replacement?: string };

export type HeadingWikiLinkResolver = (target: ParsedWikiLinkTarget) => string | undefined;

const HIDDEN_HEADING_MARKS = new Set([
  'CodeMark',
  'EmphasisMark',
  'HeaderMark',
  'LinkMark',
  'MathMark',
  'StrikethroughMark',
  'WikiLinkAliasMark',
  'WikiLinkMark',
]);

function hiddenHeadingSourceRanges(
  markdown: string | Text,
  root: HeadingSyntaxNode,
  resolveWikiLink?: HeadingWikiLinkResolver,
): SourcePart[] {
  const ranges: SourcePart[] = [];
  const slice = (from: number, to: number) =>
    typeof markdown === 'string' ? markdown.slice(from, to) : markdown.sliceString(from, to);
  const add = (from: number, to: number, replacement?: string): void => {
    if (from < to) ranges.push({ from, to, ...(replacement !== undefined ? { replacement } : {}) });
  };
  const visit = (node: HeadingSyntaxNode, parentName = ''): void => {
    if (HIDDEN_HEADING_MARKS.has(node.name)) {
      add(node.from, node.to);
      return;
    }
    if (node.name === 'Escape') {
      add(node.from, Math.min(node.from + 1, node.to));
      return;
    }
    if (node.name === 'URL' && (parentName === 'Link' || parentName === 'Image')) {
      add(node.from, node.to);
      return;
    }
    if (node.name === 'Autolink' && node.to - node.from >= 2) {
      add(node.from, node.from + 1);
      add(node.to - 1, node.to);
    }
    if (node.name === 'WikiLink') {
      let child = node.firstChild;
      let target: HeadingSyntaxNode | null = null;
      let hasAlias = false;
      while (child) {
        if (child.name === 'WikiLinkTarget') target = child;
        if (child.name === 'WikiLinkAlias') hasAlias = true;
        if (HIDDEN_HEADING_MARKS.has(child.name)) add(child.from, child.to);
        child = child.nextSibling;
      }
      if (target) {
        const parsed = parseWikiLinkTarget(slice(node.from + 2, node.to - 2));
        if (hasAlias) add(target.from, target.to);
        else if (parsed) {
          const visibleText =
            resolveWikiLink?.(parsed) ?? (parsed.targetId ? 'Restricted page' : parsed.page);
          add(target.from, target.to, visibleText);
        }
      }
      return;
    }
    let child = node.firstChild;
    while (child) {
      visit(child, node.name);
      child = child.nextSibling;
    }
  };
  visit(root);
  return ranges.sort((left, right) => left.from - right.from || left.to - right.to);
}

export function getHeadingText(
  markdown: string | Text,
  heading: HeadingSyntaxNode,
  resolveWikiLink?: HeadingWikiLinkResolver,
): string {
  const slice = (from: number, to: number) =>
    typeof markdown === 'string' ? markdown.slice(from, to) : markdown.sliceString(from, to);
  const ranges = hiddenHeadingSourceRanges(markdown, heading, resolveWikiLink);
  let result = '';
  let position = heading.from;
  for (const range of ranges) {
    const from = Math.max(position, range.from);
    const to = Math.min(heading.to, range.to);
    if (from > position) result += slice(position, from);
    if (range.replacement !== undefined) result += range.replacement;
    position = Math.max(position, to);
  }
  if (position < heading.to) result += slice(position, heading.to);
  return result.trim();
}

/** Resolve headings without reparsing when a wiki-link title changes. */
export function resolveEditorHeadings(
  markdown: string,
  syntax: readonly HeadingSyntax[],
  resolveWikiLink?: HeadingWikiLinkResolver,
): EditorHeading[] {
  return syntax.map(({ level, from, node }) => {
    const text = getHeadingText(markdown, node, resolveWikiLink);
    return { id: getHeadingId(text), text, level, from };
  });
}

/** Synchronous fallback for environments without workers and small standalone uses. */
export function extractEditorHeadings(
  markdown: string,
  resolveWikiLink?: HeadingWikiLinkResolver,
): EditorHeading[] {
  return resolveEditorHeadings(markdown, parseEditorHeadingSyntax(markdown), resolveWikiLink);
}

export function getActiveHeadingId(
  headings: readonly EditorHeading[],
  viewportFrom: number,
): string {
  let active = headings[0];
  for (const heading of headings) {
    if (heading.from > viewportFrom) break;
    active = heading;
  }
  return active?.id ?? '';
}

/**
 * Find the heading currently closest to the top of the browser viewport.
 * CodeMirror may be embedded in a page that scrolls instead of its own
 * scroll container, so the document viewport is not sufficient here.
 */
export function getActiveHeadingIdInView(
  headings: readonly EditorHeading[],
  view: EditorView,
): string {
  if (!headings.length) return '';
  // The rendered viewport begins above the visible top edge. Start near that
  // position instead of measuring every preceding heading on every scroll.
  let low = 0;
  let high = headings.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((headings[middle]?.from ?? Infinity) <= view.viewport.from) low = middle + 1;
    else high = middle;
  }
  const start = Math.max(0, low - 1);
  let active = headings[start];
  const topBoundary = (typeof window === 'undefined' ? 0 : window.innerHeight) * 0.2;
  const documentTop = view.documentTop;
  for (let index = start; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!heading) break;
    const top = documentTop + view.lineBlockAt(heading.from).top;
    if (top > topBoundary) break;
    active = heading;
  }
  return active?.id ?? '';
}

export function scrollToEditorHeading(view: EditorView, heading: EditorHeading): void {
  view.dispatch({
    // Match the sticky page header's height and the heading scroll-margin CSS.
    effects: EditorView.scrollIntoView(heading.from, {
      y: 'start',
      yMargin: window.innerWidth >= 768 ? 72 : 52,
    }),
  });
}
