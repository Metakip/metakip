import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

type Range = { from: number; to: number; source: string };
export type LinkTarget = Range & {
  kind: 'link';
  mode: 'new' | 'markdown' | 'auto';
  text: string;
  rawLabel: string;
  url: string;
  labelFrom: number;
  labelTo: number;
  urlFrom: number;
  urlTo: number;
};
export type MathTarget = Range & {
  kind: 'math';
  block: boolean;
  value: string;
  contentFrom: number;
  contentTo: number;
};
export type VisualEditorTarget = LinkTarget | MathTarget;

function plainLabel(state: EditorState, from: number, to: number): string {
  let text = '';
  let position = from;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'Escape' && node.from >= position && node.to <= to) {
        text += state.sliceDoc(position, node.from);
        position = node.from + 1;
        return;
      }
      if (
        ['EmphasisMark', 'StrikethroughMark', 'CodeMark'].includes(node.name) &&
        node.from >= position &&
        node.to <= to
      ) {
        text += state.sliceDoc(position, node.from);
        position = node.to;
      }
    },
  });
  return text + state.sliceDoc(position, to);
}

export function visualEditorTarget(
  state: EditorState,
  position: number,
): VisualEditorTarget | null {
  for (const side of [1, -1] as const) {
    let node = syntaxTree(state).resolveInner(position, side);
    for (;;) {
      if (
        !['Link', 'Autolink', 'InlineMath', 'BlockMath'].includes(node.name) &&
        !(node.name === 'URL' && node.parent?.name === 'Paragraph')
      ) {
        if (!node.parent) break;
        node = node.parent;
        continue;
      }
      const { from, to } = node;
      const source = state.sliceDoc(from, to);
      if (node.name === 'Link') {
        const url = node.getChild('URL');
        const open = node.firstChild;
        const close = node
          .getChildren('LinkMark')
          .find((mark) => state.sliceDoc(mark.from, mark.to) === ']');
        if (url && open && close) {
          const destination = state.sliceDoc(url.from, url.to);
          const angleWrapped = destination.startsWith('<') && destination.endsWith('>');
          return {
            kind: 'link',
            mode: 'markdown',
            from,
            to,
            source,
            text: plainLabel(state, open.to, close.from),
            rawLabel: state.sliceDoc(open.to, close.from),
            url: angleWrapped ? destination.slice(1, -1) : destination,
            labelFrom: open.to - from,
            labelTo: close.from - from,
            urlFrom: url.from - from + (angleWrapped ? 1 : 0),
            urlTo: url.to - from - (angleWrapped ? 1 : 0),
          };
        }
      }
      if (node.name === 'Autolink' || (node.name === 'URL' && node.parent?.name === 'Paragraph')) {
        const text = node.name === 'Autolink' ? source.slice(1, -1) : source;
        return {
          kind: 'link',
          mode: 'auto',
          from,
          to,
          source,
          text,
          rawLabel: text,
          url: /^[^\s@:/]+@[^\s@/]+$/.test(text) ? `mailto:${text}` : text,
          labelFrom: 0,
          labelTo: 0,
          urlFrom: 0,
          urlTo: 0,
        };
      }
      if (node.name === 'InlineMath' || node.name === 'BlockMath') {
        const marks = node.getChildren('MathMark');
        const first = marks[0];
        const last = marks[1];
        if (!first || !last) return null;
        const block = node.name === 'BlockMath';
        const contentFrom = block ? state.doc.lineAt(from).to + 1 : first.to;
        const contentTo = block
          ? Math.max(contentFrom, state.doc.lineAt(last.from).from - 1)
          : last.from;
        return {
          kind: 'math',
          from,
          to,
          source,
          block,
          value: state.sliceDoc(contentFrom, contentTo),
          contentFrom: contentFrom - from,
          contentTo: contentTo - from,
        };
      }
      if (!node.parent) break;
      node = node.parent;
    }
  }
  return null;
}

export function newLinkTarget(state: EditorState): LinkTarget | null {
  const { from, to } = state.selection.main;
  let node = syntaxTree(state).resolveInner(from, 1);
  for (;;) {
    if (
      [
        'WikiLink',
        'InlineMath',
        'BlockMath',
        'InlineCode',
        'FencedCode',
        'CodeBlock',
        'Image',
      ].includes(node.name)
    )
      return null;
    if (!node.parent) break;
    node = node.parent;
  }
  const source = state.sliceDoc(from, to);
  return {
    kind: 'link',
    mode: 'new',
    from,
    to,
    source,
    text: plainLabel(state, from, to),
    rawLabel: source,
    url: '',
    labelFrom: 0,
    labelTo: 0,
    urlFrom: 0,
    urlTo: 0,
  };
}

export function escapeMarkdownLinkLabel(text: string): string {
  return text.replace(/[\\`*_[\]<>~$|]/g, '\\$&');
}

function escapeMarkdownLinkSourceLabel(text: string): string {
  let result = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\' && index + 1 < text.length) {
      result += character + text[index + 1];
      index += 1;
    } else if (character === '\\') {
      result += '\\\\';
    } else if (character === '[' || character === ']') {
      result += `\\${character}`;
    } else {
      result += character;
    }
  }
  return result;
}

function encodeMarkdownLinkUrl(url: string): string {
  return url.replace(/[\s<>\\()|]/g, (character) =>
    character === '(' ? '%28' : character === ')' ? '%29' : encodeURIComponent(character),
  );
}

export function markdownLink(text: string, url: string): string {
  return `[${escapeMarkdownLinkLabel(text)}](${encodeMarkdownLinkUrl(url)})`;
}

export function linkMarkdown(target: LinkTarget, text: string, url: string): string {
  const encodedUrl = encodeMarkdownLinkUrl(url);
  const label =
    text === target.text
      ? target.mode === 'new'
        ? escapeMarkdownLinkSourceLabel(target.rawLabel)
        : target.rawLabel
      : escapeMarkdownLinkLabel(text);
  if (target.mode === 'markdown')
    return (
      target.source.slice(0, target.labelFrom) +
      label +
      target.source.slice(target.labelTo, target.urlFrom) +
      encodedUrl +
      target.source.slice(target.urlTo)
    );
  if (target.mode === 'auto' && text === target.text) return `<${encodedUrl}>`;
  return `[${label}](${encodedUrl})`;
}

export function removedLinkText(target: LinkTarget): string {
  // Escaping punctuation prevents GFM from immediately auto-linking a removed URL again.
  return /^(?:https?:\/\/|www\.)/i.test(target.rawLabel) ||
    /^[^\s@]+@[^\s@]+$/.test(target.rawLabel)
    ? target.rawLabel.replace(/[.:@]/g, '\\$&')
    : target.rawLabel;
}
