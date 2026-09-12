import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parseWikiLinkTarget } from './wikiLink.js';

export const COLLABORATIVE_CONTENT_FIELD = 'content';

const WIKI_LINK_PATTERN = /(?<!!)(\[\[([^|\]\n]+?)(?:\|([^\]\n]*))?\]\])/g;

type MarkdownPosition = {
  start?: { offset?: number };
  end?: { offset?: number };
};

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: MarkdownPosition;
};

export type MarkdownWikiLink = {
  from: number;
  to: number;
  raw: string;
  authoredTarget: string;
  targetId: string | null;
  page: string;
  heading: string;
  alias: string;
};

export function normalizeCollaborativeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n');
}

function parseMarkdown(markdown: string): MarkdownNode {
  return unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(markdown) as MarkdownNode;
}

export function visitMarkdownText(
  markdown: string,
  visitor: (source: string, from: number, to: number) => void,
): void {
  const tree = parseMarkdown(markdown);
  const visit = (node: MarkdownNode): void => {
    if (node.type === 'text' && typeof node.value === 'string') {
      const from = node.position?.start?.offset;
      const to = node.position?.end?.offset;
      // mdast decodes escapes and character references in node.value while
      // positions continue to address the original Markdown. Always scan the
      // source slice so matches and replacement offsets stay in one coordinate
      // system.
      if (from !== undefined && to !== undefined) visitor(markdown.slice(from, to), from, to);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
}

function isEscaped(source: string, position: number): boolean {
  let backslashes = 0;
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function findMarkdownWikiLinks(markdown: string): MarkdownWikiLink[] {
  const links: MarkdownWikiLink[] = [];
  visitMarkdownText(markdown, (value, nodeFrom) => {
    WIKI_LINK_PATTERN.lastIndex = 0;
    let match = WIKI_LINK_PATTERN.exec(value);
    while (match !== null) {
      const raw = match[1];
      const parsed = raw ? parseWikiLinkTarget(raw.slice(2, -2)) : null;
      if (raw && parsed && !isEscaped(value, match.index)) {
        links.push({
          from: nodeFrom + match.index,
          to: nodeFrom + match.index + raw.length,
          raw,
          ...parsed,
        });
      }
      match = WIKI_LINK_PATTERN.exec(value);
    }
  });
  return links;
}
export type MarkdownReplacement = { from: number; to: number; insert: string };

export function applyMarkdownReplacements(
  markdown: string,
  replacements: readonly MarkdownReplacement[],
): string {
  let result = markdown;
  for (const replacement of [...replacements].sort((a, b) => b.from - a.from)) {
    result = `${result.slice(0, replacement.from)}${replacement.insert}${result.slice(replacement.to)}`;
  }
  return result;
}
