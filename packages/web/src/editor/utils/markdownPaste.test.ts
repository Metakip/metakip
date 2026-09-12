import { describe, expect, it } from 'vitest';
import { convertDelimitedToMarkdown, isLikelyMarkdown, isLikelyTableData } from './markdownPaste';

describe('Markdown paste classification', () => {
  it('preserves an existing GFM table as Markdown', () => {
    const markdown = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(isLikelyMarkdown(markdown)).toBe(true);
    expect(isLikelyTableData(markdown)).toBe(false);
    expect(isLikelyTableData('| A |\n| --- |\n| 1 |')).toBe(false);
  });

  it('recognizes delimited spreadsheet data', () => {
    expect(isLikelyTableData('A,B\n1,2')).toBe(true);
    expect(isLikelyTableData('A\tB\n1\t2')).toBe(true);
  });

  it('escapes Markdown table delimiters in spreadsheet cells', () => {
    expect(convertDelimitedToMarkdown('Name,Expression\nExample,a | b')).toBe(
      '| Name | Expression |\n| --- | --- |\n| Example | a \\| b |',
    );
  });
});
