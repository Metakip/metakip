import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  button: {
    position: 'relative',
    display: 'flex',
    width: '2rem',
    height: '2rem',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: '0.5rem',
    color: 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': colors.surfaceRaised,
    },
  },
  iconStack: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    position: 'absolute',
    transitionProperty: 'opacity, transform',
    transitionDuration: '300ms',
  },
  visible: {
    opacity: 1,
    transform: 'scale(1) rotate(0deg)',
  },
  hiddenLeft: {
    opacity: 0,
    transform: 'scale(0.5) rotate(-90deg)',
  },
  hiddenRight: {
    opacity: 0,
    transform: 'scale(0.5) rotate(90deg)',
  },
});
