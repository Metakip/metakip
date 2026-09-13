import { getUnicodeCodePointLength, MAX_PAGE_TITLE_LENGTH } from '@metakip/shared';
import { describe, expect, it } from 'vitest';
import { createCopyPageTitle, normalizePageTitle } from './pageTitle';

describe('page title Unicode boundaries', () => {
  it('counts astral characters the same way PostgreSQL char_length does', () => {
    const boundaryTitle = '📚'.repeat(MAX_PAGE_TITLE_LENGTH);
    expect(normalizePageTitle(boundaryTitle)).toBe(boundaryTitle);
    expect(() => normalizePageTitle(`${boundaryTitle}📚`)).toThrow(
      `Title must be ${MAX_PAGE_TITLE_LENGTH} characters or fewer`,
    );
  });

  it('truncates copied titles without splitting a surrogate pair', () => {
    const copiedTitle = createCopyPageTitle('📚'.repeat(MAX_PAGE_TITLE_LENGTH));
    expect(getUnicodeCodePointLength(copiedTitle)).toBe(MAX_PAGE_TITLE_LENGTH);
    expect(copiedTitle).toBe(`Copy of ${'📚'.repeat(MAX_PAGE_TITLE_LENGTH - 8)}`);
    expect(copiedTitle).not.toContain('�');
  });
});
