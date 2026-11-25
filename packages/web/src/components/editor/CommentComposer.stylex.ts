import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  composer: {
    position: 'fixed',
    zIndex: 40,
    width: '20rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.5rem',
    padding: '0.75rem',
    backgroundColor: colors.card,
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  textarea: {
    width: '100%',
    resize: 'vertical',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: colors.borderHover,
      ':focus': 'var(--metakip-neutral-zinc-500)',
      ':focus-visible': 'var(--metakip-neutral-zinc-500)',
    },
    borderRadius: '0.375rem',
    padding: '0.5rem',
    backgroundColor: colors.canvas,
    color: colors.textStrong,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    outline: 'none',
    boxShadow: {
      default: null,
      ':focus': 'none',
      ':focus-visible': 'none',
    },
  },
  textareaCompact: {
    minHeight: '2.25rem',
    padding: '0.5rem',
  },
  textareaMultiline: {
    minHeight: '5rem',
    padding: '0.5rem',
  },
  textareaLarge: {
    padding: '0.5rem 0.75rem',
  },
  cancelButton: {
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: '0.375rem 0.75rem',
    backgroundColor: {
      default: 'transparent',
      ':hover': colors.selectionHover,
    },
    color: {
      default: 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
      ':hover': 'light-dark(var(--metakip-neutral-zinc-600), var(--metakip-neutral-zinc-300))',
    },
    fontSize: '0.75rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  submitButton: {
    borderWidth: 0,
    borderRadius: '0.375rem',
    padding: '0.375rem 0.75rem',
    backgroundColor: {
      default: colors.action,
      ':hover:not(:disabled)':
        'light-dark(var(--metakip-neutral-zinc-700), var(--metakip-neutral-zinc-600))',
    },
    color: colors.onAction,
    fontSize: '0.75rem',
    fontWeight: 500,
    cursor: {
      default: 'pointer',
      ':disabled': 'not-allowed',
    },
    opacity: { default: 1, ':disabled': 0.5 },
  },
  composerActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
  },
  buttonGroup: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: '0.5rem',
  },
  error: {
    minWidth: 0,
    overflow: 'hidden',
    color: colors.textMuted,
    fontSize: '0.75rem',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});
