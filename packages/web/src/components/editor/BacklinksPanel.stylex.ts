import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  panel: {
    marginBottom: '1.5rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.75rem',
    padding: '1rem',
    backgroundColor:
      'light-dark(color-mix(in srgb, var(--metakip-neutral-zinc-50) 50%, transparent), color-mix(in srgb, var(--metakip-neutral-zinc-800) 30%, transparent))',
  },
  heading: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.75rem',
  },
  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    marginBottom: '0.5rem',
  },
  headingLabel: {
    color: colors.textSubtle,
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  headingIcon: {
    color: colors.textSubtle,
  },
  sectionIcon: {
    color: colors.textFaint,
  },
  section: {
    marginBottom: '1rem',
  },
  sectionLabel: {
    color: colors.textSubtle,
    fontSize: '0.75rem',
  },
  linkList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    borderRadius: '0.5rem',
    padding: '0.375rem 0.5rem',
    color: colors.textSecondary,
    fontSize: '0.875rem',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    backgroundColor: {
      default: 'transparent',
      ':hover':
        'light-dark(var(--metakip-neutral-zinc-100), color-mix(in srgb, var(--metakip-neutral-zinc-800) 50%, transparent))',
    },
  },
  unavailableLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    borderRadius: '0.5rem',
    padding: '0.375rem 0.5rem',
    color: colors.textFaint,
    fontSize: '0.875rem',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
  },
  pageIcon: {
    fontSize: '1rem',
  },
  pageTitle: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  moreLinks: {
    paddingInline: '0.5rem',
    color: colors.textFaint,
    fontSize: '0.75rem',
  },
});
