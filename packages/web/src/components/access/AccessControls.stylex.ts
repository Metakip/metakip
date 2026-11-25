import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  sectionHeading: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: '0.5rem',
  },
  sectionIcon: {
    display: 'flex',
    width: '1.5rem',
    height: '1.5rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.5rem',
    backgroundColor: colors.surfaceSubtle,
    color: colors.textSubtle,
  },
  sectionTitle: {
    minWidth: 0,
    color: colors.textStrong,
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  fieldBox: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.75rem',
    padding: '0.5rem',
    backgroundColor:
      'light-dark(var(--metakip-neutral-zinc-50), color-mix(in srgb, var(--metakip-neutral-zinc-950) 40%, transparent))',
  },
  inviteFields: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      '@media (min-width: 40rem)': 'minmax(0, 1fr) 5rem auto',
    },
    alignItems: {
      default: null,
      '@media (min-width: 40rem)': 'center',
    },
  },
  emailField: {
    width: '100%',
    height: '1.5rem',
  },
  emailInput: {
    height: '1.5rem',
    paddingBlock: 0,
    fontSize: '0.875rem',
  },
  permissionDropdown: {
    width: 'fit-content',
  },
  permissionTrigger: {
    paddingInline: '0.5rem',
  },
  compactPermissionTrigger: {
    paddingInline: '0.375rem',
    fontSize: '0.75rem',
  },
  submitButton: {
    display: 'inline-flex',
    height: '1.5rem',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.5rem',
    paddingInline: '0.5rem',
    backgroundColor: colors.canvas,
    color: colors.controlText,
    fontSize: '11px',
    fontWeight: 500,
    transitionProperty: 'background-color, border-color',
    transitionDuration: '150ms',
    cursor: 'pointer',
    ':hover:not(:disabled)': {
      borderColor: colors.borderHover,
      backgroundColor: colors.controlHover,
    },
    ':disabled': {
      opacity: 0.4,
      cursor: 'default',
    },
  },
  loadError: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.dangerBorder,
    borderRadius: '0.75rem',
    padding: '1rem',
    backgroundColor: colors.dangerBackground,
  },
  loadErrorTitle: {
    color: colors.dangerTextStrong,
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  loadErrorDescription: {
    marginTop: '0.25rem',
    color: colors.dangerText,
    fontSize: '0.75rem',
  },
  retryButton: {
    marginTop: '0.75rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'light-dark(#fecaca, color-mix(in srgb, #7f1d1d 50%, transparent))',
    borderRadius: '0.5rem',
    padding: '0.375rem 0.75rem',
    backgroundColor: 'transparent',
    color: colors.dangerTextStrong,
    fontSize: '0.75rem',
    fontWeight: 500,
    cursor: 'pointer',
    ':hover': { backgroundColor: colors.dangerBackgroundHover },
  },
});
