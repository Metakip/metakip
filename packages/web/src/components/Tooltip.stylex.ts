import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  root: {
    position: 'relative',
    display: 'inline-flex',
  },
  tooltip: {
    position: 'absolute',
    zIndex: 50,
    visibility: {
      default: 'hidden',
      [stylex.when.ancestor(':hover')]: 'visible',
    },
    borderRadius: '0.375rem',
    backgroundColor: 'light-dark(var(--metakip-neutral-zinc-900), var(--metakip-neutral-zinc-700))',
    padding: '0.25rem 0.5rem',
    color: 'var(--metakip-neutral-white)',
    fontSize: '0.75rem',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
    },
    pointerEvents: 'none',
    transitionProperty: 'all',
    transitionDuration: '200ms',
  },
  top: {
    bottom: '100%',
    left: '50%',
    marginBottom: '0.5rem',
    transform: 'translateX(-50%)',
  },
  bottom: {
    top: '100%',
    left: '50%',
    marginTop: '0.5rem',
    transform: 'translateX(-50%)',
  },
  bottomLeft: {
    top: '100%',
    left: 0,
    marginTop: '0.5rem',
  },
  left: {
    top: '50%',
    right: '100%',
    marginRight: '0.5rem',
    transform: 'translateY(-50%)',
  },
  right: {
    top: '50%',
    left: '100%',
    marginLeft: '0.5rem',
    transform: 'translateY(-50%)',
  },
});
