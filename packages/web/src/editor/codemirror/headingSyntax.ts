import { GFM, parser } from '@lezer/markdown';
import { mathMarkdownExtension, wikiLinkMarkdownExtension } from './markdownSyntax';

const markdownParser = parser.configure([GFM, wikiLinkMarkdownExtension, mathMarkdownExtension]);

export type HeadingSyntaxNode = {
  name: string;
  from: number;
  to: number;
  firstChild: HeadingSyntaxNode | null;
  nextSibling: HeadingSyntaxNode | null;
};

export type HeadingSyntax = {
  level: number;
  from: number;
  node: HeadingSyntaxNode;
};

type TreeNode = {
  name: string;
  from: number;
  to: number;
  firstChild: TreeNode | null;
  nextSibling: TreeNode | null;
};

function copyNode(node: TreeNode): HeadingSyntaxNode {
  const copy: HeadingSyntaxNode = {
    name: node.name,
    from: node.from,
    to: node.to,
    firstChild: null,
    nextSibling: null,
  };
  let child = node.firstChild;
  let previous: HeadingSyntaxNode | null = null;
  while (child) {
    const next = copyNode(child);
    if (previous) previous.nextSibling = next;
    else copy.firstChild = next;
    previous = next;
    child = child.nextSibling;
  }
  return copy;
}

/** Serializable heading syntax; the full document can be parsed in a worker. */
export function parseEditorHeadingSyntax(markdown: string): HeadingSyntax[] {
  const headings: HeadingSyntax[] = [];
  markdownParser.parse(markdown).iterate({
    enter(node) {
      const match = node.name.match(/^(?:ATXHeading([1-6])|SetextHeading([12]))$/);
      const level = Number(match?.[1] ?? match?.[2]);
      if (!level) return;
      headings.push({ level, from: node.from, node: copyNode(node.node) });
      return false;
    },
  });
  return headings;
}
