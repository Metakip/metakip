import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  card: {
    display: {
      default: 'block',
      '@media (min-width: 64rem)': 'none',
    },
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.75rem',
    padding: '1.5rem',
    backgroundColor: colors.card,
  },
  content: {
    minWidth: 0,
  },
  title: {
    color: colors.textStrong,
    fontSize: '0.875rem',
    fontWeight: 600,
  },
  description: {
    marginTop: '0.25rem',
    color: colors.textSubtle,
    fontSize: '0.75rem',
  },
  instructions: {
    marginTop: '0.25rem',
    color: colors.textSubtle,
    fontSize: '0.75rem',
  },
  status: {
    marginTop: '0.75rem',
    color: 'light-dark(#15803d, #4ade80)',
    fontSize: '0.75rem',
    fontWeight: 500,
  },
  installButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '1rem',
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
  },
});
