import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});
const slideUp = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(0.5rem)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});
const spin = stylex.keyframes({
  to: { transform: 'rotate(360deg)' },
});

export const styles = stylex.create({
  backdrop: {
    position: 'fixed',
    zIndex: 50,
    inset: 0,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingInline: '1rem',
    paddingBottom: '1rem',
    paddingTop: {
      default: '12vh',
      '@media (min-width: 40rem)': '16vh',
    },
    backgroundColor: 'color-mix(in srgb, var(--metakip-product-dark-surface) 55%, transparent)',
    backdropFilter: 'blur(4px)',
    animationName: fadeIn,
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  dialog: {
    width: '100%',
    maxWidth: '42rem',
    overflow: 'hidden',
    borderRadius: '1rem',
    backgroundColor: colors.card,
    boxShadow: '0 25px 50px -12px rgb(0 0 0 / 25%)',
    animationName: slideUp,
    animationDuration: '200ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  searchHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    paddingInline: '1.25rem',
  },
  searchIcon: {
    width: '1.25rem',
    height: '1.25rem',
    flexShrink: 0,
    color: colors.textFaint,
  },
  searchInput: {
    height: '4rem',
    minWidth: 0,
    flex: 1,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors.textStrong,
    fontSize: '1.125rem',
    '::placeholder': {
      color: colors.textFaint,
    },
    ':focus-visible': {
      outline: 'none',
      boxShadow: 'none',
    },
  },
  spinner: {
    width: '1.25rem',
    height: '1.25rem',
    flexShrink: 0,
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'light-dark(var(--metakip-neutral-zinc-300), var(--metakip-neutral-zinc-600))',
    borderTopColor: 'light-dark(var(--metakip-neutral-zinc-700), var(--metakip-neutral-zinc-300))',
    borderRadius: '50%',
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  clearButton: {
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: '0.375rem',
    backgroundColor: 'transparent',
    color: colors.textFaint,
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: colors.selection,
      color: colors.controlText,
    },
  },
  clearIcon: {
    width: '1rem',
    height: '1rem',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '0.75rem 1.25rem',
    color: colors.textFaint,
    fontSize: '0.75rem',
  },
  footerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
  },
  shortcutKey: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.25rem',
    padding: '0.125rem 0.375rem',
    fontFamily: 'var(--font-sans)',
  },
});
