import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  centered: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  errorPanel: {
    display: 'flex',
    maxWidth: '28rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
    padding: '2rem',
    textAlign: 'center',
  },
  onboardingErrorRoot: {
    paddingInline: '1.5rem',
  },
  onboardingErrorPanel: {
    maxWidth: '24rem',
    textAlign: 'center',
  },
  errorTitle: {
    color: colors.textStrong,
    fontSize: '1.125rem',
    fontWeight: 600,
  },
  errorCopy: {
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  onboardingErrorCopy: {
    marginTop: '0.5rem',
  },
  retryButton: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.5rem',
    padding: '0.375rem 0.75rem',
    backgroundColor: {
      default: 'transparent',
      ':hover':
        'light-dark(var(--metakip-product-light-surface), var(--metakip-product-dark-surface-raised))',
    },
    color: colors.controlText,
    fontSize: '0.875rem',
    cursor: 'pointer',
  },
  tryAgainButton: {
    marginTop: '1.25rem',
    borderWidth: 0,
    borderRadius: '0.5rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
  },
});
