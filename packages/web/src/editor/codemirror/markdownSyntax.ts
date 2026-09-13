import type { MarkdownExtension } from '@lezer/markdown';
import { parseWikiLinkTarget } from '@metakip/shared';

const OPEN_BRACKET = 91;
const BACKSLASH = 92;
const EXCLAMATION_MARK = 33;

function isEscaped(context: { char(position: number): number }, position: number): boolean {
  let backslashes = 0;
  for (let index = position - 1; context.char(index) === BACKSLASH; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/** Parse Metakip wiki links as first-class inline Markdown constructs. */
export const wikiLinkMarkdownExtension: MarkdownExtension = {
  defineNodes: [
    'WikiLink',
    'WikiLinkMark',
    'WikiLinkTarget',
    'WikiLinkAliasMark',
    'WikiLinkAlias',
    'WikiLinkLiteral',
  ],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Escape',
      parse(context, next, position) {
        const isEmbed =
          next === EXCLAMATION_MARK &&
          context.char(position + 1) === OPEN_BRACKET &&
          context.char(position + 2) === OPEN_BRACKET;
        const isEscapedLink =
          next === BACKSLASH &&
          context.char(position + 1) === OPEN_BRACKET &&
          context.char(position + 2) === OPEN_BRACKET;
        const isBracketLink = next === OPEN_BRACKET && context.char(position + 1) === OPEN_BRACKET;
        if (!isEmbed && !isEscapedLink && !isBracketLink) return -1;

        const bracketFrom = position + (isEmbed || isEscapedLink ? 1 : 0);
        let end = bracketFrom + 2;
        while (end + 1 < context.end) {
          if (context.char(end) === 10 || context.char(end) === 13) return -1;
          if (context.char(end) === 93 && context.char(end + 1) === 93) break;
          end += 1;
        }
        if (end + 1 >= context.end) return -1;
        const inner = context.slice(bracketFrom + 2, end);
        const parsed = parseWikiLinkTarget(inner);
        if (isEmbed || isEscapedLink || isEscaped(context, bracketFrom) || !parsed) {
          return context.addElement(context.elt('WikiLinkLiteral', position, end + 2));
        }
        const aliasOffset = inner.indexOf('|');
        const targetEnd = aliasOffset === -1 ? end : position + 2 + aliasOffset;
        const children = [
          context.elt('WikiLinkMark', position, position + 2),
          context.elt('WikiLinkTarget', position + 2, targetEnd),
        ];
        if (aliasOffset !== -1) {
          children.push(context.elt('WikiLinkAliasMark', targetEnd, targetEnd + 1));
          if (targetEnd + 1 < end) {
            children.push(context.elt('WikiLinkAlias', targetEnd + 1, end));
          }
        }
        children.push(context.elt('WikiLinkMark', end, end + 2));
        return context.addElement(context.elt('WikiLink', position, end + 2, children));
      },
    },
  ],
};

const DOLLAR = 36;

function isBlockMathFence(line: {
  text: string;
  pos: number;
  next: number;
  skipSpace(position: number): number;
}): boolean {
  return (
    line.next === DOLLAR &&
    line.text.charCodeAt(line.pos + 1) === DOLLAR &&
    line.skipSpace(line.pos + 2) === line.text.length
  );
}

/** Parse the inline and display forms supported by remark-math. */
export const mathMarkdownExtension: MarkdownExtension = {
  defineNodes: ['InlineMath', { name: 'BlockMath', block: true }, 'MathMark', 'MathContent'],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'FencedCode',
      parse(context, line) {
        if (!isBlockMathFence(line)) return false;
        const from = context.lineStart + line.pos;
        const contentFrom = context.lineStart + line.text.length + 1;
        const children = [context.elt('MathMark', from, from + 2)];
        let to = context.lineStart + line.text.length;

        while (context.nextLine()) {
          if (isBlockMathFence(line)) {
            const closingFrom = context.lineStart + line.pos;
            if (contentFrom < closingFrom) {
              children.push(context.elt('MathContent', contentFrom, closingFrom - 1));
            }
            children.push(context.elt('MathMark', closingFrom, closingFrom + 2));
            to = context.lineStart + line.text.length;
            context.nextLine();
            break;
          }
          to = context.lineStart + line.text.length;
        }

        context.addElement(context.elt('BlockMath', from, to, children));
        return true;
      },
    },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Emphasis',
      parse(context, next, position) {
        if (
          next !== DOLLAR ||
          context.char(position + 1) === DOLLAR ||
          context.char(position - 1) === DOLLAR
        ) {
          return -1;
        }
        let end = position + 1;
        while (end < context.end) {
          if (context.char(end) === 10 || context.char(end) === 13) return -1;
          if (context.char(end) === DOLLAR && context.char(end - 1) !== 92) break;
          end += 1;
        }
        if (end >= context.end || end === position + 1) return -1;
        return context.addElement(
          context.elt('InlineMath', position, end + 1, [
            context.elt('MathMark', position, position + 1),
            context.elt('MathContent', position + 1, end),
            context.elt('MathMark', end, end + 1),
          ]),
        );
      },
    },
  ],
};
