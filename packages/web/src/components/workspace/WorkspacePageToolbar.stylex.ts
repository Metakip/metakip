import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  content: {
    display: 'flex',
    minHeight: '2.25rem',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  breadcrumb: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: '0.5rem',
  },
  homeLink: {
    display: 'flex',
    height: '2rem',
    flexShrink: 0,
    alignItems: 'center',
    gap: '0.25rem',
    borderRadius: '0.375rem',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    color: {
      default: null,
      ':hover': colors.textStrong,
    },
  },
  homeIcon: {
    display: 'flex',
    width: '2rem',
    height: '2rem',
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: {
    flexShrink: 0,
    color: 'light-dark(var(--metakip-neutral-zinc-300), var(--metakip-neutral-zinc-600))',
  },
  title: {
    overflow: 'hidden',
    color: colors.textStrong,
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});
