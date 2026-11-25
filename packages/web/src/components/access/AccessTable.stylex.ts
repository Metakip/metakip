import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  table: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.2fr) 0.5fr 0.7fr',
    columnGap: '0.5rem',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: colors.border,
    borderRadius: '0.75rem',
  },
  compact: {
    gridTemplateColumns: 'minmax(0, 1fr) auto',
  },
  header: {
    display: 'grid',
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    gap: '0.5rem',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors.border,
    padding: '0.5rem 0.75rem',
    color: colors.textSubtle,
    fontSize: '11px',
    fontWeight: 500,
  },
  row: {
    display: 'grid',
    gridColumn: '1 / -1',
    gridTemplateColumns: 'subgrid',
    alignItems: 'center',
    gap: '0.5rem',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors.border,
    padding: '0.375rem 0.75rem',
    ':last-child': { borderBottomWidth: 0 },
  },
  message: {
    gridColumn: '1 / -1',
    padding: '0.625rem 0.75rem',
    color: colors.textSubtle,
    fontSize: '0.75rem',
    textAlign: 'center',
  },
});
