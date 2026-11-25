import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  toolbarActions: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: '0.25rem',
  },
  button: {
    position: 'relative',
    borderWidth: 0,
    borderRadius: '0.375rem',
    backgroundColor: 'transparent',
    padding: '0.5rem',
    color: 'var(--metakip-neutral-zinc-400)',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
    cursor: 'pointer',
  },
  starred: {
    color: '#eab308',
    backgroundColor: {
      ':hover': 'light-dark(#fefce8, color-mix(in oklab, #713f12 20%, transparent))',
    },
    ':hover': { color: '#eab308' },
  },
  unstarred: {
    backgroundColor: {
      ':hover': colors.selection,
    },
    color: {
      default: 'var(--metakip-neutral-zinc-400)',
      ':hover': 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    },
  },
  commentsOpen: {
    backgroundColor: colors.selection,
    color: {
      default: colors.controlText,
      ':hover': colors.controlText,
    },
  },
  commentsClosed: {
    backgroundColor: {
      ':hover': colors.selection,
    },
    color: {
      default: 'var(--metakip-neutral-zinc-400)',
      ':hover': 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    },
  },
  share: {
    color: {
      default: 'var(--metakip-neutral-zinc-400)',
      ':hover': 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    },
    backgroundColor: {
      ':hover': colors.selection,
    },
  },
  menuTrigger: {
    display: 'flex',
    width: '2rem',
    height: '2rem',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: 0,
    backgroundColor: {
      default: 'transparent',
      ':hover': colors.selection,
    },
    color: {
      default: 'var(--metakip-neutral-zinc-400)',
      ':hover': 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    },
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
    cursor: 'pointer',
  },
});
