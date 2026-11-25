import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

export const styles = stylex.create({
  root: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingInline: '1rem',
  },
  headerActions: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
  },
  card: {
    width: '100%',
    maxWidth: '24rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.5rem',
    backgroundColor: colors.card,
    padding: '2rem',
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    animationName: fadeIn,
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
  },
  title: {
    marginBottom: '0.5rem',
    color: colors.text,
    fontSize: '1.5rem',
    fontWeight: 600,
    textAlign: 'center',
  },
  description: {
    marginBottom: '1.5rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
    textAlign: 'center',
  },
  providers: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  providerButton: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.375rem',
    padding: '0.625rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
    cursor: 'pointer',
  },
  googleButton: {
    backgroundColor: {
      default: colors.card,
      ':hover':
        'light-dark(var(--metakip-product-light-surface), var(--metakip-product-dark-surface-raised))',
    },
    color: colors.textSecondary,
  },
  githubButton: {
    borderColor: 'transparent',
    backgroundColor: {
      default: 'light-dark(var(--metakip-neutral-zinc-900), var(--metakip-neutral-white))',
      ':hover': colors.contrastHover,
    },
    color: colors.onContrast,
  },
  providerIcon: {
    width: '1.25rem',
    height: '1.25rem',
  },
  legal: {
    marginTop: '1.5rem',
    color: colors.textSubtle,
    fontSize: '0.75rem',
    lineHeight: '1.25rem',
    textAlign: 'center',
  },
  legalLink: {
    textDecorationLine: 'underline',
    textUnderlineOffset: '2px',
    color: {
      default: 'inherit',
      ':hover': colors.textStrong,
    },
  },
});
