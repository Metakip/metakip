import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const pageTreeRowMarker = stylex.defineMarker();

export const styles = stylex.create({
  row: {
    position: 'relative',
    display: 'flex',
    height: '2rem',
    alignItems: 'center',
    margin: '0.125rem 0',
    borderRadius: '0.5rem',
    padding: '0.25rem 0.5rem 0.25rem 0',
    transitionProperty: 'all',
    transitionDuration: '200ms',
    transitionTimingFunction: 'ease-in-out',
    cursor: 'pointer',
  },
  activeRow: {
    backgroundColor: colors.hoverOverlay,
    color: colors.textStrong,
    fontWeight: 500,
    boxShadow: '0 1px 2px rgb(0 0 0 / 2%)',
  },
  inactiveRow: {
    color: colors.textMuted,
    ':hover': {
      backgroundColor: colors.hoverOverlay,
      color: colors.textStrong,
    },
  },
  dragTarget: {
    opacity: 0.6,
  },
  expandButton: {
    display: 'flex',
    width: '1.25rem',
    height: '1.25rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '0.5rem',
    borderWidth: 0,
    borderRadius: '0.375rem',
    backgroundColor: 'transparent',
    color: colors.textFaint,
    transitionProperty:
      'color, background-color, border-color, text-decoration-color, fill, stroke',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  expandable: {
    ':hover': {
      backgroundColor: 'light-dark(rgb(0 0 0 / 10%), rgb(255 255 255 / 10%))',
      color: 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    },
  },
  emptyExpandButton: {
    opacity: 0.5,
  },
  grabbable: {
    cursor: 'grab',
    ':active': { cursor: 'grabbing' },
  },
  pointer: {
    cursor: 'pointer',
  },
  pageIcon: {
    fontSize: '0.875rem',
    lineHeight: 1,
  },
  activeIcon: {
    color: colors.textStrong,
  },
  inactiveIcon: {
    color: colors.textFaint,
  },
  content: {
    display: 'flex',
    minWidth: 0,
    flex: 1,
    alignItems: 'center',
    transitionProperty: 'padding',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  contentMenuResponsive: {
    paddingRight: {
      default: '0.5rem',
      [stylex.when.ancestor(':hover', pageTreeRowMarker)]: '3.5rem',
      [stylex.when.ancestor(':focus-within', pageTreeRowMarker)]: '3.5rem',
      [stylex.when.ancestor('[data-sidebar-menu-open]', pageTreeRowMarker)]: '3.5rem',
    },
  },
  editInput: {
    width: '100%',
    minWidth: 0,
    height: '1.5rem',
    flex: 1,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'light-dark(rgb(0 0 0 / 10%), rgb(255 255 255 / 10%))',
    borderRadius: '0.375rem',
    padding: '0.125rem 0.25rem',
    backgroundColor: 'light-dark(color-mix(in srgb, white 50%, transparent), rgb(0 0 0 / 20%))',
    color: colors.textStrong,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    ':focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px color-mix(in srgb, #3b82f6 50%, transparent)',
    },
  },
  title: {
    overflow: 'hidden',
    paddingTop: '0.125rem',
    fontSize: '0.875rem',
    lineHeight: 1,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  contextActions: {
    position: 'absolute',
    zIndex: 20,
    right: '0.25rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.125rem',
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover', pageTreeRowMarker)]: 1,
      [stylex.when.ancestor(':focus-within', pageTreeRowMarker)]: 1,
      [stylex.when.ancestor('[data-sidebar-menu-open]', pageTreeRowMarker)]: 1,
    },
    pointerEvents: {
      default: 'none',
      [stylex.when.ancestor(':hover', pageTreeRowMarker)]: 'auto',
      [stylex.when.ancestor(':focus-within', pageTreeRowMarker)]: 'auto',
      [stylex.when.ancestor('[data-sidebar-menu-open]', pageTreeRowMarker)]: 'auto',
    },
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  addButton: {
    borderWidth: 0,
    borderRadius: '0.5rem',
    padding: '0.25rem',
    backgroundColor: 'transparent',
    color: 'var(--metakip-neutral-zinc-400)',
    transitionProperty:
      'color, background-color, border-color, text-decoration-color, fill, stroke',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: 'light-dark(rgb(0 0 0 / 10%), rgb(255 255 255 / 10%))',
      color: colors.textStrong,
    },
  },
  contextButton: {
    borderWidth: 0,
    borderRadius: '0.5rem',
    padding: '0.25rem',
    backgroundColor: 'transparent',
    color: 'var(--metakip-neutral-zinc-400)',
    transitionProperty:
      'color, background-color, border-color, text-decoration-color, fill, stroke',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: 'light-dark(rgb(0 0 0 / 10%), rgb(255 255 255 / 10%))',
      color: colors.textStrong,
    },
  },
  actionsPopup: {
    borderRadius: '1rem',
    boxShadow: '0 8px 30px light-dark(rgb(0 0 0 / 12%), rgb(0 0 0 / 50%))',
  },
});
