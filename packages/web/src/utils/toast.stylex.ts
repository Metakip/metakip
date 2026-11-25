import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

const slideDown = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(-0.5rem)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

export const styles = stylex.create({
  container: {
    position: 'fixed',
    zIndex: 70,
    top: '1rem',
    left: '50%',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    transform: 'translateX(-50%)',
    pointerEvents: 'none',
  },
  toast: {
    display: 'flex',
    minWidth: 240,
    maxWidth: 420,
    alignItems: 'center',
    gap: '0.75rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.5rem',
    padding: '0.75rem 1rem',
    backgroundColor: colors.card,
    color: colors.text,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    animationName: slideDown,
    animationDuration: '200ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
    pointerEvents: 'auto',
  },
  icon: {
    flexShrink: 0,
    color: colors.textSubtle,
  },
  message: {
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  actionButton: {
    flexShrink: 0,
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
    color: colors.text,
    fontSize: '0.875rem',
    fontWeight: 500,
    textDecorationLine: 'underline',
    cursor: 'pointer',
  },
  dismissButton: {
    display: 'flex',
    flexShrink: 0,
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
    color: colors.text,
    cursor: 'pointer',
  },
});
