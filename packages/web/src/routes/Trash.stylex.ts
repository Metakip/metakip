import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

const spin = stylex.keyframes({
  to: { transform: 'rotate(360deg)' },
});

export const styles = stylex.create({
  trash: {
    display: 'flex',
    maxWidth: '48rem',
    flexDirection: 'column',
    gap: '2rem',
  },
  pageTitle: {
    color: colors.textStrong,
    fontSize: '1.5rem',
    fontWeight: 600,
  },
  pageDescription: {
    marginTop: '0.25rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  card: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.75rem',
    padding: '1.5rem',
    backgroundColor: colors.card,
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.375rem',
    padding: '0.375rem 0.625rem',
    backgroundColor: colors.controlBackground,
    fontSize: '0.75rem',
    fontWeight: 500,
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':disabled': {
      opacity: 0.5,
    },
  },
  destructiveButton: {
    borderRadius: '0.5rem',
    color: colors.dangerText,
    ':hover:not(:disabled)': {
      borderColor: 'light-dark(#fecaca, #991b1b)',
      backgroundColor: 'light-dark(#fef2f2, color-mix(in srgb, #7f1d1d 20%, transparent))',
    },
  },
  restoreButton: {
    color: colors.textSecondary,
    ':hover:not(:disabled)': {
      backgroundColor:
        'light-dark(var(--metakip-neutral-zinc-50), var(--metakip-neutral-zinc-700))',
    },
  },
  loadingState: {
    display: 'flex',
    justifyContent: 'center',
    paddingBlock: '2rem',
  },
  spinner: {
    width: '1.5rem',
    height: '1.5rem',
    borderWidth: 0,
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors.contrast,
    borderRadius: '50%',
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  errorState: {
    paddingBlock: '2rem',
    textAlign: 'center',
  },
  errorMessage: {
    color: colors.dangerText,
    fontSize: '0.875rem',
  },
  retryButton: {
    marginTop: '0.75rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.375rem',
    padding: '0.375rem 0.75rem',
    backgroundColor: 'transparent',
    color: colors.controlText,
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    ':hover': {
      backgroundColor:
        'light-dark(var(--metakip-neutral-zinc-50), var(--metakip-neutral-zinc-800))',
    },
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  trashItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.5rem',
    padding: '0.75rem',
    backgroundColor:
      'light-dark(var(--metakip-product-light-surface), color-mix(in srgb, var(--metakip-product-dark-surface-raised) 50%, transparent))',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    ':hover': {
      backgroundColor: colors.selection,
    },
  },
  itemContent: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: '0.75rem',
  },
  itemIcon: {
    flexShrink: 0,
    color: colors.textFaint,
  },
  itemEmoji: {
    fontSize: '1.125rem',
    lineHeight: 1,
  },
  itemText: {
    minWidth: 0,
  },
  itemTitle: {
    overflow: 'hidden',
    color: colors.textStrong,
    fontSize: '0.875rem',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  itemMeta: {
    color: colors.textSubtle,
    fontSize: '0.75rem',
  },
  itemActions: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: '0.5rem',
    marginLeft: '1rem',
  },
});
