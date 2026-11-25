import type { CollaboratorDisplay } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getInitial } from '../../utils/avatar';
import { formatCollaboratorLabel } from '../../utils/formatCollaboratorLabel';
import { styles } from './CollaboratorAvatars.stylex';

interface CollaboratorAvatarsProps {
  collaborators: CollaboratorDisplay[];
  max?: number;
}

function Avatar({ collab, label }: { collab: CollaboratorDisplay; label: string }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const handleMouseEnter = () => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setTooltipStyle({
        position: 'fixed',
        left: `${rect.left + rect.width / 2}px`,
        top: `${rect.top - 8}px`,
        transform: 'translate(-50%, -100%)',
        zIndex: 99999,
      });
    }
    setShowTooltip(true);
  };

  return (
    <div
      ref={anchorRef}
      {...stylex.props(styles.avatar)}
      role="tooltip"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div {...stylex.props(styles.imageAvatar, !collab.avatarUrl && styles.imageAvatarFallback)}>
        {collab.avatarUrl ? (
          <img
            src={collab.avatarUrl}
            alt={collab.name ?? 'User'}
            {...stylex.props(styles.image)}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span {...stylex.props(styles.initial)}>{getInitial(collab.name ?? 'U')}</span>
        )}
      </div>
      {showTooltip &&
        createPortal(
          <span {...stylex.props(styles.tooltip)} style={tooltipStyle}>
            {label}
          </span>,
          document.body,
        )}
    </div>
  );
}

function OverflowBadge({ count }: { count: number }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});

  const handleMouseEnter = () => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setTooltipStyle({
        position: 'fixed',
        left: `${rect.left + rect.width / 2}px`,
        top: `${rect.top - 8}px`,
        transform: 'translate(-50%, -100%)',
        zIndex: 99999,
      });
    }
    setShowTooltip(true);
  };

  return (
    <div
      ref={anchorRef}
      {...stylex.props(styles.avatar)}
      role="tooltip"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div {...stylex.props(styles.overflowAvatar)}>+{count}</div>
      {showTooltip &&
        createPortal(
          <span {...stylex.props(styles.tooltip)} style={tooltipStyle}>
            {`${count} more`}
          </span>,
          document.body,
        )}
    </div>
  );
}

export function CollaboratorAvatars({ collaborators, max = 3 }: CollaboratorAvatarsProps) {
  if (collaborators.length === 0) return null;

  const visible = collaborators.slice(0, max);
  const overflow = collaborators.length - max;

  return (
    <div {...stylex.props(styles.avatarStack)}>
      {visible.map((collab) => (
        <Avatar key={collab.userId} collab={collab} label={formatCollaboratorLabel(collab)} />
      ))}
      {overflow > 0 && <OverflowBadge count={overflow} />}
    </div>
  );
}
