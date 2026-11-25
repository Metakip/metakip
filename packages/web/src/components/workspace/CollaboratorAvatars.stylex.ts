import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  avatar: {
    position: 'relative',
    marginInlineStart: {
      default: null,
      ':not(:first-child)': '-0.375rem',
    },
  },
  imageAvatar: {
    display: 'flex',
    position: 'relative',
    width: '1.5rem',
    height: '1.5rem',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: colors.card,
    borderRadius: '50%',
  },
  imageAvatarFallback: {
    backgroundColor: '#71717a',
  },
  overflowAvatar: {
    display: 'flex',
    width: '1.5rem',
    height: '1.5rem',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderColor: colors.card,
    borderRadius: '50%',
    backgroundColor: colors.selection,
    color: colors.textSubtle,
    fontSize: '0.5rem',
    fontWeight: 700,
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  initial: {
    color: 'white',
    fontSize: 9,
    fontWeight: 700,
  },
  tooltip: {
    position: 'fixed',
    zIndex: 99999,
    pointerEvents: 'none',
    borderRadius: '0.375rem',
    padding: '0.25rem 0.5rem',
    backgroundColor: 'light-dark(var(--metakip-neutral-zinc-900), var(--metakip-neutral-zinc-700))',
    color: 'white',
    fontSize: '0.75rem',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  avatarStack: {
    display: 'flex',
    alignItems: 'center',
  },
});
