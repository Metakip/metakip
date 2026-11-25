import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

const enter = stylex.keyframes({
  from: { opacity: 0, transform: 'translate(-50%, 0.5rem)' },
  to: { opacity: 1, transform: 'translate(-50%, 0)' },
});

export const styles = stylex.create({
  toolbar: {
    position: 'fixed',
    zIndex: 40,
    bottom: '1rem',
    left: '50%',
    display: 'flex',
    width: 'max-content',
    maxWidth: 'calc(100vw - 2rem)',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.25rem',
    transform: 'translateX(-50%)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.75rem',
    padding: '0.625rem 0.75rem',
    backgroundColor: colors.card,
    color: colors.text,
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    animationName: enter,
    animationDuration: '200ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
    '@media (min-width: 40rem)': {
      bottom: '1.5rem',
      paddingInline: '1rem',
    },
  },
  actionButton: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: '0.375rem',
    borderWidth: 0,
    borderRadius: '0.5rem',
    padding: '0.375rem 0.625rem',
    backgroundColor: 'transparent',
    color: colors.text,
    fontSize: '0.875rem',
    whiteSpace: 'nowrap',
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':disabled': {
      opacity: 0.3,
      cursor: 'default',
    },
    ':disabled:hover': {
      backgroundColor: 'transparent',
    },
    ':hover:not([aria-disabled="true"])': {
      backgroundColor: colors.selection,
    },
  },
  disabledActionButton: {
    opacity: 0.3,
    cursor: 'default',
    ':disabled:hover': {
      backgroundColor: 'transparent',
    },
    ':hover[aria-disabled="true"]': {
      backgroundColor: 'transparent',
    },
  },
  selectButton: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: '0.375rem',
    borderWidth: 0,
    borderRadius: '0.5rem',
    padding: '0.375rem 0.625rem',
    backgroundColor: 'transparent',
    color: colors.text,
    fontSize: '0.875rem',
    whiteSpace: 'nowrap',
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover:not([aria-disabled="true"])': {
      backgroundColor: colors.selection,
    },
  },
  pendingDisabled: {
    opacity: 0.5,
    cursor: 'wait',
  },
  removeButton: {
    color: colors.dangerText,
    ':hover:not([aria-disabled="true"])': {
      backgroundColor: 'light-dark(#fef2f2, color-mix(in srgb, #7f1d1d 30%, transparent))',
    },
  },
  separator: {
    display: {
      default: 'none',
      '@media (min-width: 40rem)': 'block',
    },
    width: '1px',
    height: '1.25rem',
    marginInline: '0.25rem',
    backgroundColor: colors.borderRaised,
  },
  selectionCount: {
    flexShrink: 0,
    paddingInline: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  responsiveLabel: {
    display: {
      default: 'none',
      '@media (min-width: 48rem)': 'inline',
    },
  },
  clearButton: {
    flexShrink: 0,
    borderWidth: 0,
    borderRadius: '0.5rem',
    padding: '0.375rem',
    backgroundColor: 'transparent',
    color: colors.text,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover:not([aria-disabled="true"])': {
      backgroundColor: colors.selection,
    },
  },
});
