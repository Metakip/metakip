export type MarkdownListKind = 'bullet' | 'ordered' | 'task';

type ParsedListLine = {
  indent: string;
  kind: MarkdownListKind;
  body: string;
  checked: boolean;
};

function parseListLine(line: string): ParsedListLine | null {
  const unordered = line.match(/^(\s*)[-+*]\s+(?:\[([ xX])\]\s+)?(.*)$/);
  if (unordered) {
    const checkbox = unordered[2];
    return {
      indent: unordered[1] ?? '',
      kind: checkbox === undefined ? 'bullet' : 'task',
      body: unordered[3] ?? '',
      checked: checkbox?.toLowerCase() === 'x',
    };
  }

  const ordered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
  if (!ordered) return null;
  return {
    indent: ordered[1] ?? '',
    kind: 'ordered',
    body: ordered[2] ?? '',
    checked: false,
  };
}

function plainLineParts(line: string): Pick<ParsedListLine, 'indent' | 'body'> {
  const match = line.match(/^(\s*)(.*)$/);
  return { indent: match?.[1] ?? '', body: match?.[2] ?? line };
}

/**
 * Toggle or convert complete Markdown list lines while preserving their
 * indentation and content. Numbering is tracked independently per nesting
 * depth so converting a nested selection does not flatten its structure.
 */
export function toggleMarkdownList(
  lines: readonly string[],
  targetKind: MarkdownListKind,
): string[] {
  const parsed = lines.map(parseListLine);
  const removeTarget = parsed.every((line) => line?.kind === targetKind);
  if (removeTarget) {
    return parsed.map((line, index) => {
      const original = lines[index] ?? '';
      return line ? `${line.indent}${line.body}` : original;
    });
  }

  const nextOrderedNumber = new Map<string, number>();
  return lines.map((line, index) => {
    const existing = parsed[index];
    const { indent, body } = existing ?? plainLineParts(line);
    if (targetKind === 'bullet') return `${indent}- ${body}`;
    if (targetKind === 'task') {
      const checkbox = existing?.kind === 'task' && existing.checked ? 'x' : ' ';
      return `${indent}- [${checkbox}] ${body}`;
    }

    const number = nextOrderedNumber.get(indent) ?? 1;
    nextOrderedNumber.set(indent, number + 1);
    return `${indent}${number}. ${body}`;
  });
}
