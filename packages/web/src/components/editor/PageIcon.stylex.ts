import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  root: {
    display: 'flex',
    width: '2.5rem',
    height: '2.5rem',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.5rem',
    color: colors.text,
    fontSize: '2.25rem',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    backgroundColor: {
      default: null,
      ':hover': colors.selection,
    },
  },
  fallbackIcon: {
    width: '2rem',
    height: '2rem',
    color: colors.textFaint,
  },
});
