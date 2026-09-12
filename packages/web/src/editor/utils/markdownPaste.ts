import Papa from 'papaparse';

export function isLikelyMarkdown(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return [
    /^#{1,6}\s/m,
    /^>\s/m,
    /^[-*+]\s/m,
    /^\d+\.\s/m,
    /^-{3,}$/m,
    /^```/m,
    /\*\*[^*]+\*\*/,
    /`[^`]+`/,
    /\[[^\]]+\]\([^)]+\)/,
    /\|.+\|/,
    /~~[^~]+~~/,
    /^- \[( |x)\]\s/m,
    /\$[^$]+\$/,
    /^\$\$[\s\S]*?\$\$$/m,
  ].some((pattern) => pattern.test(trimmed));
}

function isGfmTable(markdown: string): boolean {
  const lines = markdown.trim().split('\n');
  const header = lines[0];
  const separator = lines[1];
  if (!header || !separator || !header.includes('|')) return false;
  const separatorCells = separator.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  return separatorCells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell));
}

export function isLikelyTableData(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.split('\n').length < 2 || isGfmTable(trimmed)) return false;
  const result = Papa.parse<unknown[]>(trimmed, { delimiter: '', preview: 5 });
  const columnCount = result.data[0]?.length ?? 0;
  return columnCount >= 2 && result.data.every((row) => row.length === columnCount);
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function convertDelimitedToMarkdown(text: string): string {
  const result = Papa.parse<unknown[]>(text.trim(), { delimiter: '' });
  if (result.data.length === 0) return '';
  const rows = result.data.map((row) =>
    row.map((cell) => escapeTableCell(String(cell ?? '').trim())),
  );
  const columnCount = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array(columnCount - row.length).fill('')]);
  const first = padded[0] ?? [];
  return [
    `| ${first.join(' | ')} |`,
    `| ${first.map(() => '---').join(' | ')} |`,
    ...padded.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}
