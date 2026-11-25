import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  section: {
    marginBottom: '0.5rem',
  },
  toggle: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    marginBottom: '0.5rem',
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingInline: '0.25rem',
    color: colors.textFaint,
    fontSize: '0.6875rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textAlign: 'left',
    textTransform: 'uppercase',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover': {
      color: 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    },
  },
  icon: {
    flexShrink: 0,
    marginRight: '0.25rem',
  },
  aliasRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.125rem',
  },
});
