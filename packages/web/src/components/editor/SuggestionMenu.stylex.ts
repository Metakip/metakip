import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

const enterDown = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(-0.5rem) scale(0.95)' },
  to: { opacity: 1, transform: 'translateY(0) scale(1)' },
});
const enterUp = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(0.5rem) scale(0.95)' },
  to: { opacity: 1, transform: 'translateY(0) scale(1)' },
});

export const styles = stylex.create({
  menu: {
    width: '20rem',
    maxWidth: 'calc(100vw - 2rem)',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.75rem',
    backgroundColor: colors.card,
    color: colors.text,
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  },
  opensDown: {
    animationName: enterDown,
    animationDuration: '100ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  opensUp: {
    animationName: enterUp,
    animationDuration: '100ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  header: {
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor:
      'light-dark(var(--metakip-neutral-zinc-100), color-mix(in srgb, var(--metakip-neutral-zinc-800) 50%, transparent))',
    padding: '0.5rem 0.75rem',
    color: 'var(--metakip-neutral-zinc-500)',
    fontSize: '0.6875rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  list: {
    display: 'flex',
    maxHeight: '18.75rem',
    flexDirection: 'column',
    gap: '0.125rem',
    overflowY: 'auto',
    padding: '0.375rem',
    scrollbarColor: `${colors.border} transparent`,
    scrollbarWidth: 'thin',
  },
  emptyState: {
    padding: '1rem 0.75rem',
    color: 'var(--metakip-neutral-zinc-500)',
    fontSize: '0.875rem',
    textAlign: 'center',
  },
  option: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: '0.75rem',
    borderWidth: 0,
    borderRadius: '0.5rem',
    padding: '0.5rem 0.625rem',
    backgroundColor: 'transparent',
    fontSize: '0.875rem',
    textAlign: 'left',
    transitionProperty: 'background-color, color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover': {
      backgroundColor:
        'light-dark(var(--metakip-neutral-zinc-50), color-mix(in srgb, var(--metakip-neutral-zinc-800) 50%, transparent))',
      color: colors.textStrong,
    },
  },
  optionSelected: {
    backgroundColor: colors.selection,
    color: colors.text,
    boxShadow: '0 1px 2px rgb(0 0 0 / 5%)',
  },
  optionIdle: {
    color: colors.textMuted,
  },
  optionIcon: {
    display: 'flex',
    width: '1.75rem',
    height: '1.75rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor:
      'light-dark(var(--metakip-neutral-zinc-200), color-mix(in srgb, var(--metakip-neutral-zinc-700) 50%, transparent))',
    borderRadius: '0.375rem',
    backgroundColor:
      'light-dark(var(--metakip-neutral-zinc-100), color-mix(in srgb, var(--metakip-neutral-zinc-800) 80%, transparent))',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  optionText: {
    minWidth: 0,
    flex: 1,
    overflow: 'hidden',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionShortcut: {
    marginLeft: 'auto',
    paddingLeft: '0.5rem',
    color: 'var(--metakip-neutral-zinc-500)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.75rem',
  },
  fileIcon: {
    width: '0.875rem',
    height: '0.875rem',
    color: 'var(--metakip-neutral-zinc-500)',
  },
  actionIcon: {
    width: '1rem',
    height: '1rem',
    color: 'var(--metakip-neutral-zinc-500)',
  },
  divider: {
    height: '1px',
    margin: '0.25rem',
    backgroundColor:
      'light-dark(var(--metakip-neutral-zinc-100), color-mix(in srgb, var(--metakip-neutral-zinc-800) 50%, transparent))',
  },
});
