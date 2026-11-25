import * as stylex from '@stylexjs/stylex';
import { colors } from '../theme.stylex';

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

export const styles = stylex.create({
  loadingPage: {
    display: 'flex',
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  page: {
    minHeight: '100vh',
    backgroundColor: colors.surface,
    color: colors.text,
  },
  headerActions: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
  },
  main: {
    display: 'grid',
    minHeight: '100vh',
    placeItems: 'center',
    paddingBlock: '2.5rem',
    paddingInline: {
      default: '1.25rem',
      '@media (min-width: 40rem)': '2rem',
    },
  },
  content: {
    width: '100%',
    maxWidth: '36rem',
    marginInline: 'auto',
    animationName: fadeIn,
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  title: {
    color: 'light-dark(var(--metakip-neutral-zinc-950), var(--metakip-neutral-white))',
    fontSize: '1.875rem',
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  description: {
    maxWidth: '32rem',
    marginTop: '0.75rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
    lineHeight: '1.5rem',
  },
  claim: {
    marginTop: '2rem',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: colors.border,
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors.border,
  },
  claimContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    paddingBlock: '1rem',
  },
  claimIcon: {
    display: 'flex',
    width: '2rem',
    height: '2rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.textSubtle,
  },
  claimText: {
    minWidth: 0,
    flex: 1,
    textAlign: 'left',
  },
  claimTitle: {
    overflow: 'hidden',
    color: colors.text,
    fontSize: '0.875rem',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  claimDescription: {
    marginTop: '0.25rem',
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  acceptingStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '1.25rem',
    color: colors.textSubtle,
    fontSize: '0.75rem',
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '1.25rem',
  },
  actionButton: {
    display: 'inline-flex',
    height: '2.25rem',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.375rem',
    paddingInline: '0.75rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    transitionProperty: 'color, border-color, background-color',
    transitionDuration: '150ms',
    ':disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  secondaryButton: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.textSecondary,
    cursor: 'pointer',
    ':hover:not(:disabled)': {
      backgroundColor:
        'light-dark(var(--metakip-neutral-zinc-50), var(--metakip-neutral-zinc-800))',
    },
  },
  primaryButton: {
    borderWidth: 0,
    cursor: 'pointer',
  },
  learnLink: {
    gap: '0.375rem',
  },
});
