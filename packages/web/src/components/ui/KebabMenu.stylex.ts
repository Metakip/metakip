import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  trigger: {
    cursor: 'pointer',
  },
  triggerOpen: {
    backgroundColor: colors.selectionHover,
    color: colors.textStrong,
    opacity: 1,
  },
  positioner: {
    zIndex: 9999,
  },
  popup: {
    display: 'flex',
    width: 'var(--kebab-menu-width, 10rem)',
    maxHeight: 'var(--available-height)',
    flexDirection: 'column',
    overflowY: 'auto',
    transformOrigin: 'var(--transform-origin)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'light-dark(rgb(0 0 0 / 5%), rgb(255 255 255 / 5%))',
    borderRadius: '0.75rem',
    padding: '0.375rem',
    backgroundColor: colors.card,
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 10%), 0 8px 10px -6px rgb(0 0 0 / 10%)',
    outline: 'none',
    transitionProperty: 'opacity, transform',
    transitionDuration: '100ms',
    ':is([data-starting-style], [data-ending-style])': {
      transform: 'scale(0.95)',
      opacity: 0,
    },
  },
  menuItem: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: '0.625rem',
    borderWidth: 0,
    borderRadius: '0.75rem',
    padding: '0.5rem 0.625rem',
    backgroundColor: 'transparent',
    color: colors.textSecondary,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    textAlign: 'left',
    outline: 'none',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':is([data-highlighted])': {
      backgroundImage: `linear-gradient(${colors.hoverOverlay}, ${colors.hoverOverlay})`,
    },
  },
  selectedMenuItem: {
    backgroundColor: colors.selection,
    color: colors.textStrong,
  },
  disabledMenuItem: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  destructiveItem: {
    color: colors.dangerText,
    ':is([data-highlighted])': {
      backgroundImage:
        'linear-gradient(color-mix(in srgb, #ef4444 10%, transparent), color-mix(in srgb, #ef4444 10%, transparent))',
    },
  },
  separator: {
    height: '1px',
    margin: '0.25rem',
    backgroundColor: colors.borderRaised,
  },
});
