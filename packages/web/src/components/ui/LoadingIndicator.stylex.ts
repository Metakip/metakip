import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

const spin = stylex.keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});

export const styles = stylex.create({
  icon: {
    color: colors.textFaint,
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  sm: {
    width: '1.25rem',
    height: '1.25rem',
  },
  md: {
    width: '1.5rem',
    height: '1.5rem',
  },
});
