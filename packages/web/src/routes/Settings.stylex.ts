import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  settings: {
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
  documentationLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '0.75rem',
    color: {
      default: colors.textSecondary,
      ':hover': 'light-dark(var(--metakip-neutral-zinc-950), var(--metakip-neutral-white))',
    },
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  card: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.75rem',
    padding: '1.5rem',
    backgroundColor: colors.card,
  },
  memberHeader: {
    marginBottom: '1rem',
  },
  sectionTitle: {
    color: colors.textStrong,
    fontSize: '0.875rem',
    fontWeight: 600,
  },
  sectionDescription: {
    color: colors.textSubtle,
    fontSize: '0.75rem',
  },
  spacedCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: {
      default: 'pointer',
      ':disabled': 'pointer',
    },
    opacity: {
      default: 1,
      ':disabled': 0.6,
    },
  },
});
