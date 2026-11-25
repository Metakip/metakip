import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  route: {
    display: 'flex',
    width: '100%',
    minWidth: 0,
    flexDirection: 'column',
  },
  content: {
    width: '100%',
    maxWidth: '56rem',
    marginTop: '1rem',
    marginRight: 'auto',
    marginLeft: 'auto',
    paddingInline: {
      default: '1.5rem',
      '@media (min-width: 48rem)': '3rem',
    },
  },
  loadError: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    borderRadius: '0.375rem',
    padding: '1rem',
    backgroundColor: 'light-dark(#fef2f2, color-mix(in srgb, #7f1d1d 20%, transparent))',
    color: colors.dangerText,
  },
  retryErrorButton: {
    flexShrink: 0,
    borderWidth: 0,
    borderRadius: '0.25rem',
    padding: '0.25rem 0.75rem',
    backgroundColor: {
      default: 'light-dark(#fee2e2, color-mix(in srgb, #7f1d1d 40%, transparent))',
      ':hover': 'light-dark(#fecaca, color-mix(in srgb, #7f1d1d 60%, transparent))',
    },
    color: colors.dangerText,
    fontSize: '0.875rem',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '5rem',
    textAlign: 'center',
  },
  emptyIcon: {
    marginBottom: '1rem',
    color: 'light-dark(var(--metakip-neutral-zinc-300), var(--metakip-neutral-zinc-600))',
  },
  emptyTitle: {
    marginBottom: '0.5rem',
    color: colors.text,
    fontSize: '1.125rem',
    fontWeight: 500,
  },
  emptyDescription: {
    maxWidth: '24rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
});
