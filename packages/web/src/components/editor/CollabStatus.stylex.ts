import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
  },
  avatarList: {
    display: {
      default: 'flex',
      '@media (max-width: 39.999rem)': 'none',
    },
    alignItems: 'center',
  },
  avatar: {
    position: 'relative',
    display: 'flex',
    width: '1.75rem',
    height: '1.75rem',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: '2.5px',
    borderStyle: 'solid',
    borderRadius: '50%',
    backgroundColor: colors.selection,
    transitionProperty: 'transform',
    transitionDuration: '150ms',
    marginLeft: {
      default: null,
      ':not(:first-child)': '-0.5rem',
    },
    zIndex: {
      default: null,
      ':hover': 10,
    },
    transform: {
      default: null,
      ':hover': 'scale(1.1)',
    },
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarEmoji: {
    fontSize: '1rem',
  },
  avatarInitial: {
    color: 'var(--metakip-neutral-white)',
    fontSize: '0.75rem',
    fontWeight: 700,
  },
  overflowCount: {
    display: 'flex',
    width: '1.75rem',
    height: '1.75rem',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '50%',
    backgroundColor: colors.selection,
    color: colors.textSubtle,
    fontSize: '0.625rem',
    fontWeight: 700,
  },
  statusButton: {
    position: 'relative',
    display: 'flex',
    width: '2rem',
    height: '2rem',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.375rem',
    backgroundColor: {
      default: 'transparent',
      ':hover': colors.selection,
    },
    transitionProperty: 'background-color',
    transitionDuration: '200ms',
    cursor: 'pointer',
  },
  statusDot: {
    display: 'inline-flex',
    width: '0.75rem',
    height: '0.75rem',
    borderRadius: '50%',
    transitionProperty: 'background-color',
    transitionDuration: '300ms',
  },
  connecting: {
    backgroundColor: '#f59e0b',
  },
  connected: {
    backgroundColor: '#10b981',
  },
  disconnected: {
    backgroundColor: '#f43f5e',
  },
});
