import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

const spin = stylex.keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});

export const styles = stylex.create({
  button: {
    display: 'inline-flex',
    height: '2.25rem',
    alignItems: 'center',
    gap: '0.5rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.375rem',
    backgroundColor: {
      default: colors.card,
      ':hover':
        'light-dark(var(--metakip-product-light-surface), var(--metakip-product-dark-surface-raised))',
    },
    paddingInline: '0.75rem',
    color: colors.textSecondary,
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
  spinner: {
    animationName: spin,
    animationDuration: '1s',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
});
