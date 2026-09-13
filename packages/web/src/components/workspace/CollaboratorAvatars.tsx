import type { CollaboratorDisplay } from '@metakip/shared';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getInitial } from '../../utils/avatar';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  edit: 'Editor',
  view: 'Viewer',
};

function formatCollabLabel(collab: CollaboratorDisplay): string {
  const name = collab.name ?? 'User';
  const role = collab.isOwner ? 'Owner' : (ROLE_LABELS[collab.permission] ?? collab.permission);
  return `${name} (${role})`;
}

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
      className="relative group/collab"
      role="tooltip"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className="relative w-6 h-6 rounded-full border-[1.5px] border-white dark:border-zinc-900 overflow-hidden flex items-center justify-center"
        style={{ backgroundColor: collab.avatarUrl ? undefined : '#71717a' }}
      >
        {collab.avatarUrl ? (
          <img
            src={collab.avatarUrl}
            alt={collab.name ?? 'User'}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-[9px] font-bold text-white">{getInitial(collab.name ?? 'U')}</span>
        )}
      </div>
      {showTooltip &&
        createPortal(
          <span
            className="fixed z-[99999] whitespace-nowrap rounded-md bg-zinc-900 dark:bg-zinc-700 px-2 py-1 text-xs font-medium text-white pointer-events-none"
            style={tooltipStyle}
          >
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
      className="relative group/collab"
      role="tooltip"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="w-6 h-6 rounded-full border-[1.5px] border-white dark:border-zinc-900 bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[8px] font-bold text-zinc-500 dark:text-zinc-400">
        +{count}
      </div>
      {showTooltip &&
        createPortal(
          <span
            className="fixed z-[99999] whitespace-nowrap rounded-md bg-zinc-900 dark:bg-zinc-700 px-2 py-1 text-xs font-medium text-white pointer-events-none"
            style={tooltipStyle}
          >
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
    <div className="flex items-center -space-x-1.5">
      {visible.map((collab) => (
        <Avatar key={collab.userId} collab={collab} label={formatCollabLabel(collab)} />
      ))}
      {overflow > 0 && <OverflowBadge count={overflow} />}
    </div>
  );
}
