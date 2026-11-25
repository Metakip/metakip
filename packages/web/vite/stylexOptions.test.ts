import { transform } from 'lightningcss';
import { describe, expect, it } from 'vitest';
import { stylexOptions } from './stylexOptions';

describe('StyleX color compilation', () => {
  it('preserves native theme colors when color-scheme lives in a separate stylesheet', () => {
    const { code } = transform({
      filename: 'stylex.css',
      // Exercise lowering even when the host's Browserslist targets change.
      targets: { chrome: 120 << 16 },
      ...stylexOptions.lightningcssOptions,
      code: Buffer.from(`
        .panel {
          color: light-dark(var(--light-text), var(--dark-text));
          background-color: light-dark(#fff, color-mix(in srgb, #18181b 70%, transparent));
          border-color: light-dark(#e4e4e7, #27272a);
          box-shadow: 0 8px 30px light-dark(rgb(0 0 0 / 8%), rgb(0 0 0 / 30%));
        }
        .panel:hover { background-color: light-dark(#f4f4f5, #27272a); }
      `),
    });
    const css = code.toString();

    expect(css.match(/light-dark\(/g)).toHaveLength(5);
    expect(css).not.toContain('--lightningcss-light');
    expect(css).not.toContain('--lightningcss-dark');
  });
});
