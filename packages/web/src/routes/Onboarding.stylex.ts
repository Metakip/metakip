import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  root: {
    minHeight: '100vh',
    backgroundColor: colors.surface,
    color: colors.text,
  },
  main: {
    display: 'flex',
    minHeight: '100vh',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBlock: '2.5rem',
    paddingInline: {
      default: '1.25rem',
      '@media (min-width: 40rem)': '2rem',
    },
  },
});
