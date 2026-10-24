import { describe, expect, it } from 'vitest';
import { resolveCodeFenceLanguage } from './codeLanguages';

describe('code fence language resolution', () => {
  it.each([
    ['py', 'Python'],
    ['rs', 'Rust'],
    ['md', 'Markdown'],
    ['ts', 'TypeScript'],
  ])('resolves the %s fence label to %s', (label, expectedName) => {
    expect(resolveCodeFenceLanguage(label)?.name).toBe(expectedName);
  });

  it.each([
    'text',
    'text/plain',
    'plaintext',
    'plain',
    'txt',
  ])('leaves the %s fence label as plain text', (label) => {
    expect(resolveCodeFenceLanguage(label)).toBeNull();
  });

  it('matches language names and extensions without fuzzy matches', () => {
    expect(resolveCodeFenceLanguage('PY')?.name).toBe('Python');
    expect(resolveCodeFenceLanguage('Rust')?.name).toBe('Rust');
    expect(resolveCodeFenceLanguage('text/plain-extra')).toBeNull();
  });
});
