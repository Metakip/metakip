import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

// Filled actions own their foreground, fill, and hover as one policy. Components
// compose a tone with their local geometry instead of rebuilding the color pair.
export const actionColors = stylex.create({
  contrast: {
    color: colors.onContrast,
    backgroundColor: {
      default: colors.contrast,
      ':hover:not(:disabled)': colors.contrastHover,
    },
  },
  subdued: {
    color: colors.onAction,
    backgroundColor: {
      default: colors.action,
      ':hover:not(:disabled)': colors.actionHover,
    },
  },
  destructive: {
    color: colors.onAction,
    backgroundColor: {
      default: colors.dangerAction,
      ':hover:not(:disabled)': colors.dangerActionHover,
    },
  },
});
