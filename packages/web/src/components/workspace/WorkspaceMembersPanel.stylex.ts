import * as stylex from '@stylexjs/stylex';
import { colors } from '../../theme.stylex';

export const styles = stylex.create({
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  loading: {
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  emptyState: {
    margin: 0,
    color: colors.textSubtle,
    fontSize: '0.875rem',
  },
  membersSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  memberIdentity: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: '0.5rem',
  },
  avatar: {
    display: 'flex',
    width: '1.5rem',
    height: '1.5rem',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: '50%',
    backgroundColor: 'var(--metakip-neutral-zinc-500)',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarInitial: {
    color: 'white',
    fontSize: '9px',
    fontWeight: 700,
  },
  memberName: {
    maxWidth: '18ch',
    overflow: 'hidden',
    color: colors.textStrong,
    fontSize: '0.875rem',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  memberRole: {
    color: colors.textSubtle,
    fontSize: '0.75rem',
  },
  memberEmail: {
    overflow: 'hidden',
    color: colors.textSubtle,
    fontSize: '11px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});
