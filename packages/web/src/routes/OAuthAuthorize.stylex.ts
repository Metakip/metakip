import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  loadingPage: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  authorizePage: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    backgroundColor: colors.surface,
  },
  card: {
    width: '100%',
    maxWidth: '32rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.75rem',
    padding: '1.75rem',
    backgroundColor: colors.card,
    boxShadow: '0 1px 2px rgb(0 0 0 / 5%)',
  },
  unavailableTitle: {
    color: colors.textStrong,
    fontSize: '1.25rem',
    fontWeight: 600,
  },
  unavailableDescription: {
    marginTop: '0.75rem',
    color: colors.textMuted,
    fontSize: '0.875rem',
  },
  eyebrow: {
    color: colors.textSubtle,
    fontSize: '0.75rem',
    fontWeight: 500,
    letterSpacing: '0.025em',
    textTransform: 'uppercase',
  },
  clientTitle: {
    marginTop: '0.5rem',
    color: colors.textStrong,
    fontSize: '1.5rem',
    fontWeight: 600,
  },
  website: {
    marginTop: '0.5rem',
    color: colors.textMuted,
    fontSize: '0.875rem',
  },
  websiteLink: {
    color: 'inherit',
    fontWeight: 500,
    textDecoration: 'underline',
  },
  requestDescription: {
    marginTop: '0.75rem',
    color: colors.textMuted,
    fontSize: '0.875rem',
  },
  scopeList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    marginTop: '1.5rem',
  },
  scopeOption: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.5rem',
    padding: '0.75rem',
    cursor: 'pointer',
  },
  checkbox: {
    width: '1rem',
    height: '1rem',
    marginTop: '0.125rem',
    accentColor: colors.text,
    cursor: 'pointer',
    ':disabled': {
      cursor: 'default',
    },
  },
  scopeLabel: {
    display: 'block',
    color: colors.textStrong,
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  offlineNotice: {
    display: 'block',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.5rem',
    padding: '0.75rem',
  },
  offlineTitle: {
    display: 'block',
    color: colors.textStrong,
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  offlineDescription: {
    marginTop: '0.25rem',
    color: colors.textMuted,
    fontSize: '0.875rem',
  },
  submitError: {
    marginTop: '0.75rem',
    color: colors.dangerText,
    fontSize: '0.875rem',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    marginTop: '1.5rem',
  },
  button: {
    borderRadius: '0.375rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    ':disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  primaryButton: {
    borderWidth: 0,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
  },
  returnButton: {
    marginTop: '1.5rem',
  },
  cancelButton: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderHover,
    backgroundColor: 'transparent',
    color: colors.textSecondary,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    ':hover:not(:disabled)': {
      backgroundColor:
        'light-dark(var(--metakip-neutral-zinc-50), var(--metakip-neutral-zinc-800))',
    },
  },
});
