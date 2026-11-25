import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  textBox: {
    display: 'flex',
    height: '1.5rem',
    alignItems: 'center',
    gap: '0.5rem',
  },
  leadingIcon: {
    flexShrink: 0,
    color: 'var(--metakip-neutral-zinc-400)',
  },
  textInput: {
    minWidth: 0,
    flex: 1,
    borderWidth: 0,
    borderRadius: '0.25rem',
    paddingInline: '0.25rem',
    backgroundColor: 'transparent',
    color: colors.inputText,
    fontSize: 14,
    lineHeight: '1.5rem',
    caretColor: colors.inputText,
    outline: 'none',
    '::placeholder': {
      color: 'var(--metakip-neutral-zinc-400)',
    },
    cursor: {
      default: null,
      ':disabled': 'default',
    },
  },
  rightSlot: {
    flexShrink: 0,
  },
  dropdown: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  dropdownTrigger: {
    display: 'inline-flex',
    width: 'fit-content',
    height: '1.5rem',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.375rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '0.5rem',
    paddingInline: '0.5rem',
    backgroundColor: {
      default: colors.canvas,
      ':hover:not(:disabled)': colors.controlHover,
    },
    color: colors.controlText,
    fontSize: 11,
    fontWeight: 500,
    transitionProperty: 'background-color, border-color',
    transitionDuration: '150ms',
    cursor: {
      default: 'pointer',
      ':disabled': 'default',
    },
    borderColor: {
      default: colors.border,
      ':hover:not(:disabled)': colors.borderHover,
      ':focus': colors.borderStrong,
      ':focus-visible': colors.borderStrong,
    },
    opacity: {
      default: 1,
      ':disabled': 0.6,
    },
    outline: {
      default: null,
      ':focus-visible': 'none',
    },
  },
  dropdownLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dropdownChevron: {
    flexShrink: 0,
    color: 'var(--metakip-neutral-zinc-400)',
    transitionProperty: 'transform',
    transitionDuration: '150ms',
  },
  dropdownChevronOpen: {
    transform: 'rotate(180deg)',
  },
  dropdownMenu: {
    zIndex: 50,
    overflowX: 'hidden',
    overflowY: 'auto',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.5rem',
    paddingBlock: '0.25rem',
    backgroundColor: colors.card,
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  },
  dropdownOption: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.75rem',
    borderWidth: 0,
    padding: '0.375rem 0.75rem',
    backgroundColor: {
      default: 'transparent',
      ':hover':
        'light-dark(var(--metakip-neutral-zinc-50), color-mix(in srgb, var(--metakip-neutral-zinc-800) 50%, transparent))',
    },
    color: {
      default: colors.textSecondary,
      ':hover': colors.textStrong,
    },
    fontSize: '0.75rem',
    textAlign: 'left',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
  },
  dropdownOptionActive: {
    backgroundColor: colors.selection,
    color: colors.textStrong,
    ':hover': {
      backgroundColor: colors.selection,
      color: colors.textStrong,
    },
  },
  dropdownCheck: {
    flexShrink: 0,
    color: 'var(--metakip-neutral-zinc-500)',
  },
  choiceGroup: {
    display: 'inline-flex',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.75rem',
    padding: '0.25rem',
    backgroundColor: colors.selection,
  },
  choiceGroupDisabled: {
    opacity: 0.6,
  },
  choiceButton: {
    borderWidth: 0,
    borderRadius: '0.5rem',
    padding: '0.375rem 0.75rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    transitionProperty: 'color, background-color',
    transitionDuration: '150ms',
    cursor: {
      default: 'pointer',
      ':disabled': 'default',
    },
  },
  choiceActive: {
    backgroundColor: colors.controlBackground,
    color: colors.headingText,
    boxShadow: '0 1px 2px rgb(0 0 0 / 5%)',
  },
  choiceInactive: {
    backgroundColor: {
      default: 'transparent',
      ':hover': 'transparent',
    },
    color: {
      default: colors.textSubtle,
      ':hover': colors.textStrong,
    },
  },
});
