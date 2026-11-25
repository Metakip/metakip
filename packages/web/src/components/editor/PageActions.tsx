import type { PageDetailPayload, SharePermission } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { Maximize2, MessageSquare, Minimize2, Share, Star } from 'lucide-react';
import { useState } from 'react';
import { useShareContext } from '../../contexts/ShareContext';
import { useStars } from '../../hooks/use-stars';
import { useEntityActions } from '../../hooks/useEntityActions';
import { usePageActionEligibility } from '../../hooks/usePageActionEligibility';
import { Tooltip } from '../Tooltip';
import { KebabMenu, type KebabMenuItem } from '../ui/KebabMenu';
import { styles } from './PageActions.stylex';

interface PageActionsProps {
  page: PageDetailPayload;
  permission: SharePermission | null;
  onDeleted: () => void;
  isDesktopLayout: boolean;
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
  isDesktopLayout,
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

  const menuItems: KebabMenuItem[] = [];
  if (!isDesktopLayout) {
    menuItems.push(actions.star);
    if (canComment) {
      menuItems.push({
        label: commentsOpen ? 'Close comments' : 'Comments',
        icon: <MessageSquare size={14} />,
        onClick: onToggleComments,
      });
    }
    menuItems.push(actions.share);
  }
  menuItems.push(
    {
      label: fullWidth ? 'Default width' : 'Full width',
      icon: fullWidth ? <Minimize2 size={14} /> : <Maximize2 size={14} />,
      onClick: onToggleFullWidth,
    },
    ...actions.items,
  );

  return (
    <>
      {isDesktopLayout && (
        <div {...stylex.props(styles.toolbarActions)}>
          <Tooltip label={actions.star.label} position="bottom">
            <button
              type="button"
              onClick={actions.star.onClick}
              aria-label={starLabel}
              {...stylex.props(styles.button, isStarred ? styles.starred : styles.unstarred)}
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
                {...stylex.props(
                  styles.button,
                  commentsOpen ? styles.commentsOpen : styles.commentsClosed,
                )}
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
              {...stylex.props(styles.button, styles.share)}
            >
              <Share size={16} />
            </button>
          </Tooltip>
        </div>
      )}
      <KebabMenu
        ariaLabel="Page actions"
        triggerStyle={styles.menuTrigger}
        popupWidth="12rem"
        onOpenChange={setMenuOpen}
        items={menuItems}
      />
      {actions.dialogs}
    </>
  );
}
