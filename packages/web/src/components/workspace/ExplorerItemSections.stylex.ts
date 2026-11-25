import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

export const styles = stylex.create({
  sections: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2rem',
  },
  animateFast: {
    animationName: fadeIn,
    animationDuration: '150ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  animateStandard: {
    animationName: fadeIn,
    animationDuration: '250ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  sectionTitle: {
    marginTop: 0,
    marginBottom: '0.75rem',
    paddingInline: '0.25rem',
    color: colors.textFaint,
    fontSize: '0.6875rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      '@media (min-width: 48rem)': 'repeat(2, minmax(0, 1fr))',
      '@media (min-width: 64rem)': 'repeat(3, minmax(0, 1fr))',
    },
    gap: '1rem',
  },
  listContainer: {
    overflow: 'clip',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.75rem',
    backgroundColor: colors.card,
  },
  listHeader: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto auto auto',
    alignItems: 'center',
    gap: '0.75rem',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors.border,
    padding: '0.5rem 1rem',
    color: colors.textFaint,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  listSpacer: {
    width: '2rem',
  },
  listName: {
    marginLeft: '-2.5rem',
  },
  optionalColumn: {
    display: {
      default: 'block',
      '@media (max-width: 47.999rem)': 'none',
    },
  },
  sharedColumn: {
    width: '7rem',
  },
  editedColumn: {
    width: '9rem',
  },
  listItems: {
    display: 'flex',
    flexDirection: 'column',
  },
});
