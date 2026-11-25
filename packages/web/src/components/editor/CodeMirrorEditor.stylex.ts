import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  wrapper: {
    position: 'relative',
    minHeight: '500px',
  },
  loadingAlignment: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorNotReady: {
    visibility: 'hidden',
  },
  errorState: {
    display: 'flex',
    maxWidth: '28rem',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '2rem',
    textAlign: 'center',
  },
  errorDescription: {
    color: colors.textMuted,
    fontSize: '0.875rem',
  },
  retryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.borderRaised,
    borderRadius: '0.5rem',
    padding: '0.375rem 0.75rem',
    backgroundColor: 'transparent',
    color: colors.controlText,
    fontSize: '0.875rem',
    cursor: 'pointer',
    ':hover': { backgroundColor: colors.controlHover },
  },
  loadingOverlay: {
    position: 'absolute',
    zIndex: 10,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
