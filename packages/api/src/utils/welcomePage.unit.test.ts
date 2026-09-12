import { lexer, type Tokens } from 'marked';
import { describe, expect, it, vi } from 'vitest';
import { WELCOME_PAGE_CONTENT } from './welcomePage';

vi.mock('../db/query', () => ({ executeQuery: vi.fn() }));
vi.mock('./pageCreation', () => ({ createPage: vi.fn() }));

describe('welcome page template', () => {
  it('separates Markdown paragraphs with blank lines', () => {
    expect(WELCOME_PAGE_CONTENT).toContain('\n\n');
  });

  it('keeps headings, lists, and the shortcuts table valid Markdown', () => {
    const tokens = lexer(WELCOME_PAGE_CONTENT);
    expect(
      tokens
        .filter((token): token is Tokens.Heading => token.type === 'heading')
        .map((token) => token.text),
    ).toEqual([
      'Features Supported',
      'Upcoming Features',
      'Importing md / Obsidian Vault',
      'Agentic Works',
      'Shortcuts',
    ]);
    expect(
      tokens
        .filter((token): token is Tokens.List => token.type === 'list')
        .map((token) => token.items.length),
    ).toEqual([14, 3]);
    const table = tokens.find((token): token is Tokens.Table => token.type === 'table');
    expect(table?.header.map((cell) => cell.text)).toEqual(['Action', 'Linux / Windows', 'macOS']);
    expect(table?.rows[0]?.[0]?.text).toBe('Toggle sidebar');
    expect(table?.rows.at(-1)?.[0]?.text).toBe('Tag');
  });
});
