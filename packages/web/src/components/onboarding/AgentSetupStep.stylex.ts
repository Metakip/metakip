import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const agentLinkMarker = stylex.defineMarker();

export const styles = stylex.create({
  content: {
    width: '100%',
    maxWidth: '42rem',
  },
  stepLabel: {
    color: colors.textSubtle,
    fontSize: '0.75rem',
    fontWeight: 500,
  },
  title: {
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
  agentGrid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      '@media (min-width: 40rem)': 'repeat(2, minmax(0, 1fr))',
    },
    gap: '0.75rem',
    marginTop: '2rem',
  },
  agentLink: {
    display: 'flex',
    minHeight: '3.5rem',
    alignItems: 'center',
    gap: '0.75rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.5rem',
    padding: '0.75rem',
    backgroundColor: colors.card,
    transitionProperty: 'border-color, background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover': {
      borderColor: colors.borderHover,
      backgroundColor:
        'light-dark(var(--metakip-product-light-surface), color-mix(in srgb, var(--metakip-product-dark-surface-raised) 50%, transparent))',
    },
  },
  agentIconContainer: {
    display: 'flex',
    width: '2.25rem',
    height: '2.25rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.5rem',
    backgroundColor: 'white',
  },
  agentIconLarge: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  agentIcon: {
    width: '75%',
    height: '75%',
    objectFit: 'contain',
  },
  agentName: {
    minWidth: 0,
    flex: 1,
    color: colors.text,
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  agentExternalIcon: {
    flexShrink: 0,
    color: 'var(--metakip-neutral-zinc-400)',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    [stylex.when.ancestor(':hover', agentLinkMarker)]: { color: colors.controlText },
  },
  alternateGuidance: {
    marginTop: '1.25rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
  },
  guideLink: {
    color: 'inherit',
    textDecoration: 'underline',
    textDecorationColor: colors.borderHover,
    textUnderlineOffset: '4px',
    cursor: 'pointer',
    ':hover': { color: colors.textStrong },
  },
  errorMessage: {
    marginTop: '1.25rem',
    borderRadius: '0.75rem',
    padding: '0.75rem 1rem',
    backgroundColor: 'light-dark(#fef2f2, color-mix(in srgb, #450a0a 40%, transparent))',
    color: colors.dangerTextStrong,
    fontSize: '0.875rem',
  },
  footer: {
    display: 'flex',
    width: '100%',
    maxWidth: '42rem',
    minHeight: '2.25rem',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: '2rem',
  },
});
