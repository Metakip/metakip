import {
  MAX_FOLDER_NAME_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  type SharePermission,
  truncateUnicodeCodePoints,
} from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useIdentityNavigate } from '../../contexts/IdentityLifecycleContext';
import { buildEntityPath, buildFolderPath, getWorkspacePath } from '../../utils/url';
import { PageContextMenu } from '../ui/PageContextMenu';
import { pageTreeRowMarker, styles } from './PageTreeRow.stylex';

interface PageTreeRowProps {
  id: string;
  title: string;
  icon?: string | null | undefined;
  ownerId?: string | null | undefined;
  createdBy?: string | null | undefined;
  userPermission?: SharePermission | null | undefined;
  shareSource?: 'direct' | 'public' | 'workspace' | undefined;
  parentId?: string | null | undefined;
  canMove?: boolean | undefined;
  isActive?: boolean;
  depth?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  isStarred?: boolean;
  showDragHandle?: boolean;
  onToggleExpand?: (() => void) | undefined;
  onCreateChild?: (() => void) | undefined;
  onNavigate?: (() => void) | undefined;
  onRename?: (() => void) | undefined;
  isEditing?: boolean;
  editTitle?: string;
  onEditChange?: ((value: string) => void) | undefined;
  onEditSave?: (() => void) | undefined;
  onEditKeyDown?: ((e: React.KeyboardEvent) => void) | undefined;
  isDragTarget?: boolean;
  isFolder?: boolean;
}

export function PageTreeRow({
  id,
  title,
  icon,
  ownerId,
  createdBy,
  userPermission,
  shareSource,
  parentId,
  canMove,
  isActive = false,
  depth = 0,
  hasChildren = false,
  isExpanded = false,
  isStarred = false,
  showDragHandle = false,
  onToggleExpand,
  onCreateChild,
  onNavigate,
  onRename,
  isEditing = false,
  editTitle = '',
  onEditChange,
  onEditSave,
  onEditKeyDown,
  isDragTarget = false,
  isFolder = false,
}: PageTreeRowProps) {
  const navigate = useIdentityNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const editLengthLimit = isFolder ? MAX_FOLDER_NAME_LENGTH : MAX_PAGE_TITLE_LENGTH;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleNavigate = () => {
    if (onNavigate) {
      onNavigate();
    } else {
      navigate(buildEntityPath(isFolder ? 'folder' : 'page', title, id));
    }
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleExpand) onToggleExpand();
  };

  const handleCreateChild = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCreateChild) onCreateChild();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      {...stylex.props(
        styles.row,
        isActive ? styles.activeRow : styles.inactiveRow,
        isDragTarget && styles.dragTarget,
        pageTreeRowMarker,
      )}
      data-sidebar-tree-row=""
      data-sidebar-menu-open={isMenuOpen ? '' : undefined}
      style={{ paddingLeft: `${depth * 12 + 12}px`, marginLeft: '8px', marginRight: '8px' }}
      onClick={handleNavigate}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleNavigate();
        }
      }}
      data-testid="page-tree-row"
      data-entity-id={id}
      data-entity-type={isFolder ? 'folder' : 'page'}
    >
      <button
        type="button"
        onClick={hasChildren ? handleToggleExpand : undefined}
        {...stylex.props(
          styles.expandButton,
          showDragHandle ? styles.grabbable : styles.pointer,
          hasChildren ? styles.expandable : styles.emptyExpandButton,
        )}
        aria-label={hasChildren ? 'Toggle nested pages' : 'Page'}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight size={14} />
          )
        ) : isFolder ? (
          <span {...stylex.props(styles.pageIcon)}>📁</span>
        ) : icon ? (
          <span {...stylex.props(styles.pageIcon)}>{icon}</span>
        ) : (
          <FileText
            size={14}
            {...stylex.props(isActive ? styles.activeIcon : styles.inactiveIcon)}
          />
        )}
      </button>

      <div
        {...stylex.props(styles.content, styles.contentMenuResponsive)}
        data-sidebar-menu-content=""
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            maxLength={editLengthLimit * 2}
            value={editTitle}
            onChange={(e) =>
              onEditChange?.(truncateUnicodeCodePoints(e.target.value, editLengthLimit))
            }
            onBlur={onEditSave}
            onKeyDown={onEditKeyDown}
            {...stylex.props(styles.editInput)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span {...stylex.props(styles.title)}>{title}</span>
        )}
      </div>

      {!isEditing && (
        <div {...stylex.props(styles.contextActions)} data-sidebar-context-actions="">
          {onCreateChild && (
            <button
              type="button"
              onClick={handleCreateChild}
              {...stylex.props(styles.addButton)}
              title="Add page"
            >
              <Plus size={14} />
            </button>
          )}

          <PageContextMenu
            item={{
              id,
              type: isFolder ? 'folder' : 'page',
              title,
              icon: icon ?? null,
              ownerId: ownerId ?? undefined,
              createdBy: createdBy ?? undefined,
              userPermission,
              shareSource,
              canMove,
            }}
            isStarred={isStarred}
            triggerStyle={styles.contextButton}
            popupStyle={styles.actionsPopup}
            onOpenChange={setIsMenuOpen}
            {...(onRename != null ? { onRename } : {})}
            {...(isActive
              ? {
                  onDeleted: () =>
                    navigate(parentId ? buildFolderPath('folder', parentId) : getWorkspacePath(), {
                      replace: true,
                    }),
                }
              : {})}
          />
        </div>
      )}
    </div>
  );
}
