import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  input: {
    width: '100%',
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors.text,
    fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    fontWeight: 700,
    lineHeight: 1.25,
    overflowWrap: 'break-word',
    outline: 'none',
    transitionProperty: 'color',
    transitionDuration: '150ms',
    '::placeholder': {
      color: 'light-dark(var(--metakip-neutral-zinc-300), var(--metakip-neutral-zinc-700))',
    },
    borderColor: {
      default: null,
      ':focus': 'transparent',
    },
    boxShadow: {
      default: null,
      ':focus': 'none',
    },
  },
});
