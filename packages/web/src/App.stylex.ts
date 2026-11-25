import * as stylex from '@stylexjs/stylex';
import { colors } from './theme.stylex';

export const styles = stylex.create({
  root: {
    minHeight: '100vh',
    backgroundColor: colors.canvas,
    color: colors.text,
  },
});
