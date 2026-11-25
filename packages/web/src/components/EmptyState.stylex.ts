import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  compact: {
    padding: '1.5rem 0.75rem',
  },
  regular: {
    padding: '3rem 1.5rem',
  },
  icon: {
    borderRadius: '9999px',
    backgroundColor: colors.selection,
    color: colors.textFaint,
  },
  iconCompact: {
    padding: '0.75rem',
  },
  iconRegular: {
    padding: '1rem',
  },
  title: {
    marginTop: '1rem',
    color: colors.textStrong,
    fontWeight: 600,
  },
  titleCompact: {
    fontSize: '0.875rem',
  },
  titleRegular: {
    fontSize: '1rem',
  },
  description: {
    marginTop: '0.25rem',
    color: colors.textSubtle,
  },
  descriptionCompact: {
    fontSize: '0.75rem',
  },
  descriptionRegular: {
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
