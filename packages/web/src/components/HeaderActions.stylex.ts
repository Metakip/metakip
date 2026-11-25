import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    borderRadius: '9999px',
    padding: '0.25rem',
  },
  themeButton: {
    position: 'relative',
    display: 'flex',
    width: '1.75rem',
    height: '1.75rem',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 0,
    borderRadius: '50%',
    padding: '0.375rem',
    color: 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': colors.selectionHover,
    },
  },
  iconFrame: {
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
    transform: 'scale(1) rotate(0deg)',
    opacity: 1,
  },
  sunHidden: {
    transform: 'scale(0.5) rotate(-90deg)',
    opacity: 0,
  },
  moonHidden: {
    transform: 'scale(0.5) rotate(90deg)',
    opacity: 0,
  },
  systemHidden: {
    transform: 'scale(0.5) rotate(90deg)',
    opacity: 0,
  },
  externalLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    padding: '0.375rem',
    color: 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': colors.selectionHover,
    },
  },
});
