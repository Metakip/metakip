import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.5rem',
    padding: '0.375rem 0.5rem',
    backgroundColor: colors.controlBackground,
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  },
  invisible: {
    visibility: 'hidden',
  },
  button: {
    borderWidth: 0,
    borderRadius: '0.25rem',
    padding: '0.375rem',
    backgroundColor: {
      default: 'transparent',
      ':hover': 'light-dark(var(--metakip-neutral-zinc-100), var(--metakip-neutral-zinc-700))',
    },
    color: 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
  },
  activeButton: {
    backgroundColor: 'light-dark(var(--metakip-neutral-zinc-100), var(--metakip-neutral-zinc-600))',
    color: 'light-dark(var(--metakip-neutral-zinc-900), var(--metakip-neutral-white))',
  },
  dangerButton: {
    color: 'light-dark(#ef4444, #f87171)',
    backgroundColor: {
      default: null,
      ':hover': 'light-dark(#fef2f2, color-mix(in srgb, #7f1d1d 50%, transparent))',
    },
  },
  divider: {
    width: '1px',
    height: '1.25rem',
    marginInline: '0.25rem',
    backgroundColor: 'light-dark(var(--metakip-neutral-zinc-200), var(--metakip-neutral-zinc-600))',
  },
});
