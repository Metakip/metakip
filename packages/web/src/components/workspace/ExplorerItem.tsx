import {
  type CollaboratorDisplay,
  MAX_FOLDER_NAME_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  type SharePermission,
  truncateUnicodeCodePoints,
} from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { Check, FileText, Folder } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { formatDate } from '../../utils/date';
import { PageContextMenu } from '../ui/PageContextMenu';
import { CollaboratorAvatars } from './CollaboratorAvatars';
import { explorerItemMarker, styles } from './ExplorerItem.stylex';

export type ExplorerItemType = 'page' | 'folder';

export interface ExplorerItemData {
  id: string;
  type: ExplorerItemType;
  title: string;
  icon?: string | null;
  updatedAt: string | Date;
  coverType?: string | null;
  coverValue?: string | null;
  ownerId?: string | null | undefined;
  createdBy?: string | null | undefined;
  userPermission?: SharePermission | null | undefined;
  shareSource?: 'direct' | 'public' | 'workspace' | undefined;
  canMove?: boolean | undefined;
  activityAt?: string | Date | undefined;
  collaborators?: CollaboratorDisplay[];
}

interface ExplorerItemProps {
  item: ExplorerItemData;
  viewMode: 'card' | 'list';
  isSelected: boolean;
  isStarred?: boolean;
  onSelect: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onNavigate: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onRename?: () => void;
  onCopy?: () => void;
  edit: {
    value: string;
    onChange: (value: string) => void;
    onSave: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
  } | null;
  collaborators?: CollaboratorDisplay[];
  canSelect?: boolean;
  showCheckboxes?: boolean;
  showContextMenu?: boolean;
}

export function ExplorerItem({
  item,
  viewMode,
  isSelected,
  isStarred = false,
  onSelect,
  onNavigate,
  onRename = () => {},
  onCopy,
  edit,
  collaborators = [],
  canSelect = true,
  showCheckboxes = false,
  showContextMenu = true,
}: ExplorerItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const editLengthLimit = item.type === 'folder' ? MAX_FOLDER_NAME_LENGTH : MAX_PAGE_TITLE_LENGTH;
  const isEditing = edit !== null;
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (isEditing) return;
    onNavigate(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isEditing || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick(e);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canSelect) return;
    onSelect(e);
  };

  const updatedDate =
    typeof item.updatedAt === 'string' ? item.updatedAt : item.updatedAt.toISOString();
  const editInput = edit && (
    <input
      ref={inputRef}
      type="text"
      maxLength={editLengthLimit * 2}
      value={edit.value}
      onChange={(e) => edit.onChange(truncateUnicodeCodePoints(e.target.value, editLengthLimit))}
      onBlur={edit.onSave}
      onKeyDown={edit.onKeyDown}
      {...stylex.props(styles.editInput)}
      onClick={(e) => e.stopPropagation()}
    />
  );

  if (viewMode === 'list') {
    return (
      /* biome-ignore-start lint/a11y/useSemanticElements: nested buttons not possible */
      <div
        role="button"
        tabIndex={0}
        {...stylex.props(styles.listRow, isSelected && styles.selected, explorerItemMarker)}
        data-explorer-list-row=""
        data-context-menu-open={isContextMenuOpen ? '' : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        data-entity-id={item.id}
        data-entity-type={item.type}
      >
        <div
          {...stylex.props(
            styles.listIcon,
            !(isSelected || showCheckboxes) && styles.listIconBackground,
            (isSelected || showCheckboxes) && styles.listSelectionVisible,
          )}
        >
          {canSelect && (
            <button
              type="button"
              {...stylex.props(
                styles.checkbox,
                styles.listCheckbox,
                isSelected ? styles.checkboxSelected : styles.checkboxUnselected,
                showCheckboxes && styles.selectionAlwaysVisible,
              )}
              onClick={handleCheckboxClick}
            >
              {isSelected && <Check size={12} strokeWidth={3} />}
            </button>
          )}
          <span
            {...stylex.props(
              styles.listIconGraphic,
              canSelect && styles.listIconGraphicSelectable,
              canSelect && (isSelected || showCheckboxes) && styles.listIconGraphicHidden,
            )}
          >
            {item.type === 'folder' ? (
              <Folder size={18} />
            ) : item.icon ? (
              <span {...stylex.props(styles.listCustomIcon)}>{item.icon}</span>
            ) : (
              <FileText size={18} />
            )}
          </span>
        </div>

        <div {...stylex.props(styles.listTitleCell)}>
          {editInput ?? <span {...stylex.props(styles.listTitle)}>{item.title || 'Untitled'}</span>}
        </div>

        <div {...stylex.props(styles.listCollaborators)}>
          {collaborators.length > 0 && <CollaboratorAvatars collaborators={collaborators} />}
        </div>

        <span {...stylex.props(styles.listUpdatedDate)}>{formatDate(updatedDate)}</span>

        {showContextMenu && (
          <div {...stylex.props(styles.listMenu)}>
            <PageContextMenu
              item={item}
              isStarred={isStarred}
              triggerStyle={styles.itemAction}
              onRename={onRename}
              onOpenChange={setIsContextMenuOpen}
              {...(onCopy ? { onCopy } : {})}
            />
          </div>
        )}
      </div>
      /* biome-ignore-end lint/a11y/useSemanticElements: nested buttons not possible */
    );
  }

  return (
    /* biome-ignore-start lint/a11y/useSemanticElements: nested buttons not possible */
    <div
      role="button"
      tabIndex={0}
      {...stylex.props(styles.card, isSelected && styles.cardSelected, explorerItemMarker)}
      data-explorer-card=""
      data-context-menu-open={isContextMenuOpen ? '' : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-entity-id={item.id}
      data-entity-type={item.type}
    >
      {canSelect && (
        <div {...stylex.props(styles.cardCheckboxWrapper)}>
          <button
            type="button"
            {...stylex.props(
              styles.checkbox,
              isSelected ? styles.checkboxSelected : styles.cardCheckboxUnselected,
            )}
            onClick={handleCheckboxClick}
          >
            {isSelected && <Check size={12} strokeWidth={3} />}
          </button>
        </div>
      )}

      {showContextMenu && (
        <div {...stylex.props(styles.cardMenu)}>
          <PageContextMenu
            item={item}
            isStarred={isStarred}
            triggerStyle={styles.itemAction}
            onRename={onRename}
            onOpenChange={setIsContextMenuOpen}
            {...(onCopy ? { onCopy } : {})}
          />
        </div>
      )}

      <div
        {...stylex.props(styles.cover)}
        data-entity-cover=""
        style={{
          background:
            item.type === 'page' && item.coverType === 'gradient'
              ? (item.coverValue ?? undefined)
              : undefined,
          backgroundColor:
            item.type === 'page' && item.coverType === 'solid'
              ? (item.coverValue ?? undefined)
              : undefined,
        }}
      >
        {item.type === 'folder' ? (
          <Folder size={40} {...stylex.props(styles.folderCoverIcon)} />
        ) : item.icon ? (
          <span {...stylex.props(styles.coverEmoji)}>{item.icon}</span>
        ) : (
          <FileText size={40} {...stylex.props(styles.fileCoverIcon)} />
        )}
      </div>

      <div {...stylex.props(styles.cardInfo)}>
        <div {...stylex.props(styles.cardTitleCell)}>
          {editInput ?? <h3 {...stylex.props(styles.cardTitle)}>{item.title || 'Untitled'}</h3>}
          <div {...stylex.props(styles.cardMetadata)}>
            <p {...stylex.props(styles.updatedDate)}>
              {item.type === 'folder' ? 'Folder' : `Edited ${formatDate(updatedDate)}`}
            </p>
          </div>
        </div>

        {collaborators.length > 0 && (
          <div {...stylex.props(styles.cardCollaborators)}>
            <CollaboratorAvatars collaborators={collaborators} max={3} />
          </div>
        )}
      </div>
    </div>
    /* biome-ignore-end lint/a11y/useSemanticElements: nested buttons not possible */
  );
}
