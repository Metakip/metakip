import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const choiceCardMarker = stylex.defineMarker();

export const styles = stylex.create({
  content: {
    width: '100%',
    maxWidth: '36rem',
  },
  stepLabel: {
    color: colors.textSubtle,
    fontSize: '0.75rem',
    fontWeight: 500,
  },
  titleFirst: {
    marginTop: '0.5rem',
    color: 'light-dark(var(--metakip-neutral-zinc-950), var(--metakip-neutral-white))',
    fontSize: '1.875rem',
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  titleNext: {
    marginTop: '1.25rem',
    color: 'light-dark(var(--metakip-neutral-zinc-950), var(--metakip-neutral-white))',
    fontSize: '1.875rem',
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  description: {
    maxWidth: '36rem',
    marginTop: '0.75rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
  },
  descriptionNext: {
    maxWidth: '32rem',
    marginTop: '0.75rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
  },
  choiceList: {
    marginTop: '2rem',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors.border,
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors.border,
  },
  choiceCard: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: '1rem',
    borderWidth: 0,
    padding: '0.875rem 0.75rem',
    backgroundColor: 'transparent',
    textAlign: 'left',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover:not(:disabled)': {
      backgroundColor:
        'light-dark(color-mix( in srgb, var(--metakip-product-light-surface-subtle) 80%, transparent ), var(--metakip-product-dark-surface-subtle))',
    },
    ':focus-visible': {
      outline: `2px solid ${colors.text}`,
      outlineOffset: '-2px',
    },
    ':disabled': {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
  },
  choiceCardSeparated: {
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors.border,
  },
  choiceIcon: {
    display: 'flex',
    width: '2rem',
    height: '2rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.textSubtle,
  },
  choiceText: {
    minWidth: 0,
    flex: 1,
  },
  choiceTitle: {
    display: 'block',
    color: colors.text,
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  choiceDescription: {
    display: 'block',
    marginTop: '0.25rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  choiceArrow: {
    flexShrink: 0,
    color: 'var(--metakip-neutral-zinc-400)',
    transitionProperty: 'color, transform',
    transitionDuration: '150ms',
    [stylex.when.ancestor(':hover', choiceCardMarker)]: {
      color: colors.controlText,
      transform: 'translateX(0.125rem)',
    },
  },
  skipAction: {
    marginTop: '1.25rem',
  },
  backButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
    color: colors.textSubtle,
    fontSize: '0.875rem',
    fontWeight: 500,
    transitionProperty: 'color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover': { color: colors.textStrong },
  },
  importGrid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      '@media (min-width: 40rem)': 'repeat(3, minmax(0, 1fr))',
    },
    gap: '0.75rem',
    marginTop: '2rem',
  },
  importOption: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.5rem',
    padding: '1rem',
    backgroundColor: colors.card,
    textAlign: 'left',
    transitionProperty: 'border-color, background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover:not(:disabled)': {
      borderColor: colors.borderHover,
      backgroundColor:
        'light-dark(var(--metakip-product-light-surface), color-mix( in srgb, var(--metakip-product-dark-surface-raised) 50%, transparent ))',
    },
    ':disabled': {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
  },
  importIcon: {
    color: colors.controlText,
  },
  obsidianIcon: {
    width: '22px',
    height: '22px',
  },
  importTitle: {
    display: 'block',
    marginTop: '1rem',
    color: colors.text,
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  importDescription: {
    display: 'block',
    marginTop: '0.25rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
  },
  compatibilityNote: {
    marginTop: '1rem',
    color: colors.textSubtle,
    fontSize: '0.75rem',
    lineHeight: '1.25rem',
  },
  compatibilityHighlight: {
    color: colors.textSecondary,
    fontWeight: 500,
  },
  visuallyHidden: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    clipPath: 'inset(50%)',
  },
  errorMessage: {
    marginTop: '1.25rem',
    borderRadius: '0.75rem',
    padding: '0.75rem 1rem',
    backgroundColor: 'light-dark(#fef2f2, color-mix(in srgb, #450a0a 40%, transparent))',
    color: colors.dangerTextStrong,
    fontSize: '0.875rem',
  },
});
