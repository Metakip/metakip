import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  content: {
    padding: '1.5rem',
  },
  title: {
    color: colors.text,
    fontSize: '1.125rem',
    fontWeight: 600,
  },
  message: {
    marginTop: '0.25rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    marginTop: '1.5rem',
  },
  cancel: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: '0.5rem 0.75rem',
    color: {
      default: colors.textMuted,
      ':hover': colors.text,
    },
    fontSize: '0.875rem',
    cursor: {
      default: 'pointer',
      ':disabled': 'not-allowed',
    },
  },
  confirm: {
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: {
      default: 'pointer',
      ':disabled': 'not-allowed',
    },
    opacity: {
      default: 1,
      ':disabled': 0.6,
    },
  },
});
