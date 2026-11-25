import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  retryState: {
    display: 'flex',
    maxWidth: '28rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
    padding: '2rem',
    textAlign: 'center',
  },
  errorState: {
    display: 'flex',
    maxWidth: '28rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
    padding: '2rem',
    textAlign: 'center',
  },
  errorPage: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  stateIcon: {
    color: 'light-dark(var(--metakip-neutral-zinc-300), var(--metakip-neutral-zinc-600))',
  },
  stateTitle: {
    color: colors.textStrong,
    fontSize: '1.125rem',
    fontWeight: 600,
  },
  stateDescription: {
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  retryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.5rem',
    padding: '0.375rem 0.75rem',
    backgroundColor: {
      default: 'transparent',
      ':hover': colors.controlHover,
    },
    color: colors.controlText,
    fontSize: '0.875rem',
    cursor: 'pointer',
  },
});
