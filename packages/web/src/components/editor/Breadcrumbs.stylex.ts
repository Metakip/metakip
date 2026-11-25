import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    overflowX: 'auto',
    color: colors.textSubtle,
    fontSize: '0.875rem',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    scrollbarWidth: 'none',
    '::-webkit-scrollbar': {
      display: 'none',
    },
  },
  item: {
    display: 'flex',
    height: '2rem',
    flexShrink: 0,
    alignItems: 'center',
    borderRadius: '0.375rem',
    paddingInline: '0.375rem',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
  },
  link: {
    backgroundColor: {
      default: 'transparent',
      ':hover':
        'light-dark(var(--metakip-neutral-zinc-100), color-mix(in srgb, var(--metakip-neutral-zinc-800) 50%, transparent))',
    },
    color: {
      default: 'inherit',
      ':hover': colors.textStrong,
    },
  },
  home: {
    width: '2rem',
    justifyContent: 'center',
    padding: 0,
  },
  current: {
    color: colors.textStrong,
  },
  separator: {
    flexShrink: 0,
    color: 'light-dark(var(--metakip-neutral-zinc-300), var(--metakip-neutral-zinc-600))',
  },
});
