import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  root: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
    paddingInline: '1rem',
  },
  card: {
    width: '100%',
    maxWidth: '28rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.75rem',
    backgroundColor: colors.card,
    padding: '1.5rem',
    textAlign: 'center',
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
  },
  title: {
    color: colors.textStrong,
    fontSize: '1.125rem',
    fontWeight: 600,
  },
  description: {
    marginTop: '0.5rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  action: {
    display: 'inline-flex',
    alignItems: 'center',
    marginTop: '1rem',
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
  },
});
