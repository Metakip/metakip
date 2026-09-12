import { EditorView } from '@codemirror/view';
import { GFM, parser } from '@lezer/markdown';
import { type ParsedWikiLinkTarget, parseWikiLinkTarget } from '@markdawn/shared';
import { getHeadingId } from '../../utils/headingNavigation';
import { mathMarkdownExtension, wikiLinkMarkdownExtension } from './markdownSyntax';

export type EditorHeading = {
  id: string;
  text: string;
  level: number;
  from: number;
};

const markdownParser = parser.configure([GFM, wikiLinkMarkdownExtension, mathMarkdownExtension]);

type HeadingTreeNode = {
  name: string;
  from: number;
  to: number;
  firstChild: HeadingTreeNode | null;
  nextSibling: HeadingTreeNode | null;
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

function headingLevel(nodeName: string): number | null {
  const match = nodeName.match(/^(?:ATXHeading([1-6])|SetextHeading([12]))$/);
  const value = match?.[1] ?? match?.[2];
  return value ? Number(value) : null;
}

function hiddenHeadingSourceRanges(
  markdown: string,
  root: HeadingTreeNode,
  resolveWikiLink?: HeadingWikiLinkResolver,
): SourcePart[] {
  const ranges: SourcePart[] = [];
  const add = (from: number, to: number, replacement?: string): void => {
    if (from < to) ranges.push({ from, to, ...(replacement !== undefined ? { replacement } : {}) });
  };
  const visit = (node: HeadingTreeNode, parentName = ''): void => {
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
      let target: HeadingTreeNode | null = null;
      let hasAlias = false;
      while (child) {
        if (child.name === 'WikiLinkTarget') target = child;
        if (child.name === 'WikiLinkAlias') hasAlias = true;
        if (HIDDEN_HEADING_MARKS.has(child.name)) add(child.from, child.to);
        child = child.nextSibling;
      }
      if (target) {
        const parsed = parseWikiLinkTarget(markdown.slice(node.from + 2, node.to - 2));
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
  markdown: string,
  heading: HeadingTreeNode,
  resolveWikiLink?: HeadingWikiLinkResolver,
): string {
  const ranges = hiddenHeadingSourceRanges(markdown, heading, resolveWikiLink);
  let result = '';
  let position = heading.from;
  for (const range of ranges) {
    const from = Math.max(position, range.from);
    const to = Math.min(heading.to, range.to);
    if (from > position) result += markdown.slice(position, from);
    if (range.replacement !== undefined) result += range.replacement;
    position = Math.max(position, to);
  }
  if (position < heading.to) result += markdown.slice(position, heading.to);
  return result.trim();
}

/** Parse the complete document rather than CodeMirror's virtualized viewport. */
export function extractEditorHeadings(
  markdown: string,
  resolveWikiLink?: HeadingWikiLinkResolver,
): EditorHeading[] {
  const headings: EditorHeading[] = [];
  markdownParser.parse(markdown).iterate({
    enter(node) {
      const level = headingLevel(node.name);
      if (level === null) return;
      const text = getHeadingText(markdown, node.node, resolveWikiLink);
      headings.push({ id: getHeadingId(text), text, level, from: node.from });
    },
  });
  return headings;
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
  let active = headings[0];
  const topBoundary = (typeof window === 'undefined' ? 0 : window.innerHeight) * 0.2;
  for (const heading of headings) {
    const top = view.documentTop + view.lineBlockAt(heading.from).top;
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
