import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

export const styles = stylex.create({
  invitation: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: '0.5rem',
  },
  icon: {
    display: 'flex',
    width: '1.5rem',
    height: '1.5rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    backgroundColor: colors.selectionHover,
    color: colors.textSubtle,
  },
  email: {
    maxWidth: '18ch',
    overflow: 'hidden',
    color: colors.textStrong,
    fontSize: '0.875rem',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  permission: {
    color: 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    fontSize: '0.75rem',
  },
  controls: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.375rem',
  },
  deliveryBadge: {
    overflow: 'hidden',
    borderRadius: '9999px',
    padding: '0.125rem 0.5rem',
    fontSize: '0.625rem',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pending: {
    backgroundColor: 'light-dark(#fffbeb, color-mix(in srgb, #451a03 40%, transparent))',
    color: 'light-dark(#b45309, #fcd34d)',
  },
  sent: {
    backgroundColor: 'light-dark(#ecfdf5, color-mix(in srgb, #022c22 40%, transparent))',
    color: 'light-dark(#047857, #6ee7b7)',
  },
  failed: {
    backgroundColor: 'light-dark(#fef2f2, color-mix(in srgb, #450a0a 40%, transparent))',
    color: colors.dangerTextStrong,
  },
  menuTrigger: {
    display: 'inline-flex',
    width: '1.5rem',
    height: '1.5rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.375rem',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': colors.selection,
    },
    color: {
      default: colors.textSubtle,
      ':hover': colors.textStrong,
    },
  },
});
