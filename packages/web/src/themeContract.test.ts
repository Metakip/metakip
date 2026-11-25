import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceDirectory = path.resolve(process.cwd(), 'src');

describe('Shared color contract', () => {
  it('exposes exactly the app color roles declared by the global stylesheet', () => {
    const css = readFileSync(path.join(sourceDirectory, 'index.css'), 'utf8');
    const contract = readFileSync(path.join(sourceDirectory, 'theme.stylex.ts'), 'utf8');
    const declared = new Set(css.match(/--color-app-[a-z-]+(?=\s*:)/g) ?? []);
    const exposed = new Set(contract.match(/--color-app-[a-z-]+/g) ?? []);

    expect([...exposed].sort()).toEqual([...declared].sort());
  });

  it('keeps component styles behind the typed contract instead of raw app variables', () => {
    const violations = readdirSync(sourceDirectory, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.stylex.ts') && file !== 'theme.stylex.ts')
      .filter((file) =>
        /var\(--color-app-/.test(readFileSync(path.join(sourceDirectory, file), 'utf8')),
      );

    expect(violations).toEqual([]);
  });
});
