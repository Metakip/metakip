import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const slideUp = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(0.5rem)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

export const styles = stylex.create({
  overlay: {
    position: 'fixed',
    zIndex: 50,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingInline: '1rem',
    backgroundColor: `color-mix(in srgb, ${colors.overlay} 40%, transparent)`,
    backdropFilter: 'blur(4px)',
    animationName: fadeIn,
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
  },
  raisedOverlay: {
    zIndex: 9999,
  },
  panel: {
    width: '100%',
    maxWidth: '28rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.75rem',
    backgroundColor: colors.card,
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    animationName: slideUp,
    animationDuration: '200ms',
    animationTimingFunction: 'ease-out',
  },
  widePanel: {
    maxWidth: '42rem',
  },
});
