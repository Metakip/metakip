import type { PageDetailPayload, SharePermission } from '@metakip/shared';
import { Maximize2, MessageSquare, Minimize2, Share, Star } from 'lucide-react';
import { useState } from 'react';
import { useShareContext } from '../../contexts/ShareContext';
import { useStars } from '../../hooks/use-stars';
import { useEntityActions } from '../../hooks/useEntityActions';
import { usePageActionEligibility } from '../../hooks/usePageActionEligibility';
import { Tooltip } from '../Tooltip';
import { KebabMenu } from '../ui/KebabMenu';

interface PageActionsProps {
  page: PageDetailPayload;
  permission: SharePermission | null;
  onDeleted: () => void;
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  canComment: boolean;
  commentsOpen: boolean;
  commentsCount: number;
  onToggleComments: () => void;
}

export function PageActions({
  page,
  permission,
  onDeleted,
  fullWidth,
  onToggleFullWidth,
  canComment,
  commentsOpen,
  commentsCount,
  onToggleComments,
}: PageActionsProps) {
  const { isAnonymous } = useShareContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const eligibility = usePageActionEligibility(page, permission, !isAnonymous && menuOpen);
  const { data: stars } = useStars({ enabled: !isAnonymous });
  const isStarred =
    stars?.some((star) => star.entityType === 'page' && star.entityId === page.id) ?? false;
  const starLabel = isStarred ? 'Unstar page' : 'Star page';
  const actions = useEntityActions({
    item: {
      id: page.id,
      type: 'page',
      title: page.title,
      icon: page.icon,
      ownerId: page.accessScope === 'account' ? page.ownerId : null,
      createdBy: page.accessScope === 'account' ? page.createdBy : null,
      userPermission: permission,
      canMove: eligibility.move === 'allowed',
      shareSource:
        eligibility.removal.status === 'ready' ? eligibility.removal.shareSource : undefined,
    },
    isStarred,
    onDeleted,
  });

  if (isAnonymous) return null;

  return (
    <>
      <div className="hidden shrink-0 items-center gap-1 md:flex">
        <Tooltip label={actions.star.label} position="bottom">
          <button
            type="button"
            onClick={actions.star.onClick}
            aria-label={starLabel}
            className={`rounded-md p-2 transition-colors cursor-pointer ${
              isStarred
                ? 'text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            <Star size={16} fill={isStarred ? 'currentColor' : 'none'} />
          </button>
        </Tooltip>
        {canComment && (
          <Tooltip
            label={`Comments${commentsCount > 0 ? ` · ${commentsCount} open` : ''}`}
            position="bottom"
          >
            <button
              type="button"
              onClick={onToggleComments}
              aria-label={commentsOpen ? 'Close comments' : 'Open comments'}
              aria-pressed={commentsOpen}
              className={`relative cursor-pointer rounded-md p-2 transition-colors ${
                commentsOpen
                  ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
                  : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800'
              }`}
            >
              <MessageSquare size={16} />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Share" position="bottom">
          <button
            type="button"
            onClick={actions.share.onClick}
            aria-label="Share page"
            data-testid="page-share-btn"
            className="cursor-pointer rounded-md p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <Share size={16} />
          </button>
        </Tooltip>
      </div>
      <KebabMenu
        ariaLabel="Page actions"
        triggerClassName="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
        menuClassName="w-48 rounded-xl border border-black/5 bg-white p-1.5 shadow-xl dark:border-white/5 dark:bg-zinc-900"
        onOpenChange={setMenuOpen}
        items={[
          {
            ...actions.star,
            className: 'md:hidden',
          },
          ...(canComment
            ? [
                {
                  label: commentsOpen ? 'Close comments' : 'Comments',
                  icon: <MessageSquare size={14} />,
                  className: 'md:hidden',
                  onClick: onToggleComments,
                },
              ]
            : []),
          {
            ...actions.share,
            className: 'md:hidden',
          },
          {
            label: fullWidth ? 'Default width' : 'Full width',
            icon: fullWidth ? <Minimize2 size={14} /> : <Maximize2 size={14} />,
            onClick: onToggleFullWidth,
          },
          ...actions.items,
        ]}
      />
      {actions.dialogs}
    </>
  );
}
