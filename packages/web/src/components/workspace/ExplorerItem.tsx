import {
  type CollaboratorDisplay,
  MAX_FOLDER_NAME_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  type SharePermission,
  truncateUnicodeCodePoints,
} from '@metakip/shared';
import clsx from 'clsx';
import { Check, FileText, Folder } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { formatDate } from '../../utils/date';
import { PageContextMenu } from '../ui/PageContextMenu';
import { CollaboratorAvatars } from './CollaboratorAvatars';

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
  isFavorite?: boolean;
  onSelect: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onNavigate: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onRename?: () => void;
  onCopy?: () => void;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onEditSave?: () => void;
  onEditKeyDown?: (e: React.KeyboardEvent) => void;
  collaborators?: CollaboratorDisplay[];
  canSelect?: boolean;
  showCheckboxes?: boolean;
  showContextMenu?: boolean;
}

export function ExplorerItem({
  item,
  viewMode,
  isSelected,
  isFavorite = false,
  onSelect,
  onNavigate,
  onRename = () => {},
  onCopy,
  isEditing = false,
  editValue = '',
  onEditChange,
  onEditSave,
  onEditKeyDown,
  collaborators = [],
  canSelect = true,
  showCheckboxes = false,
  showContextMenu = true,
}: ExplorerItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const editLengthLimit = item.type === 'folder' ? MAX_FOLDER_NAME_LENGTH : MAX_PAGE_TITLE_LENGTH;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('.item-action')) return;
    if (isEditing) return;
    onNavigate(e);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canSelect) return;
    onSelect(e);
  };

  const updatedDate =
    typeof item.updatedAt === 'string' ? item.updatedAt : item.updatedAt.toISOString();

  if (viewMode === 'list') {
    return (
      /* biome-ignore-start lint/a11y/useSemanticElements: nested buttons not possible */
      <div
        role="button"
        tabIndex={0}
        className={clsx(
          'group grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-150 w-full text-left',
          isSelected
            ? 'bg-zinc-100 dark:bg-zinc-800'
            : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50',
        )}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onKeyDown={(e) => {
          if (isEditing) return;
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick(e);
          }
        }}
        data-entity-id={item.id}
        data-entity-type={item.type}
      >
        <div
          className={clsx(
            'flex items-center justify-center w-8 h-8 rounded-md shrink-0 transition-colors',
            isSelected || isHovered || showCheckboxes
              ? 'bg-transparent'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
          )}
        >
          {canSelect && (isSelected || isHovered || showCheckboxes) ? (
            <button
              type="button"
              className={clsx(
                'item-action flex items-center justify-center w-5 h-5 rounded border transition-colors cursor-pointer',
                isSelected
                  ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100 text-white dark:text-zinc-900'
                  : 'border-zinc-300 dark:border-zinc-600 hover:border-zinc-500 dark:hover:border-zinc-400',
              )}
              onClick={handleCheckboxClick}
            >
              {isSelected && <Check size={12} strokeWidth={3} />}
            </button>
          ) : item.type === 'folder' ? (
            <Folder size={18} />
          ) : item.icon ? (
            <span className="text-lg leading-none">{item.icon}</span>
          ) : (
            <FileText size={18} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              maxLength={editLengthLimit * 2}
              value={editValue}
              onChange={(e) =>
                onEditChange?.(truncateUnicodeCodePoints(e.target.value, editLengthLimit))
              }
              onBlur={onEditSave}
              onKeyDown={onEditKeyDown}
              className="w-full max-w-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-900 dark:text-zinc-100"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate block">
              {item.title || 'Untitled'}
            </span>
          )}
        </div>

        <div className="hidden md:block shrink-0 w-28">
          {collaborators.length > 0 && <CollaboratorAvatars collaborators={collaborators} />}
        </div>

        <span className="text-xs text-zinc-400 dark:text-zinc-500 hidden md:block w-36 shrink-0">
          {formatDate(updatedDate)}
        </span>

        {showContextMenu && (
          <div className="shrink-0">
            <PageContextMenu
              item={item}
              isFavorite={isFavorite}
              triggerClassName="item-action p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
              onRename={onRename}
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
      className={clsx(
        'group relative block w-full text-left p-5 bg-white dark:bg-zinc-900 border rounded-xl cursor-pointer transition-all duration-200 overflow-visible',
        isSelected
          ? 'border-zinc-900 dark:border-zinc-100 ring-2 ring-zinc-900 dark:ring-zinc-100'
          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-md hover:scale-[1.02]',
      )}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (isEditing) return;
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e);
        }
      }}
      data-entity-id={item.id}
      data-entity-type={item.type}
    >
      {canSelect && (
        <div className="absolute top-3 left-3 z-10">
          <button
            type="button"
            className={clsx(
              'item-action flex items-center justify-center w-5 h-5 rounded border transition-colors cursor-pointer',
              isSelected
                ? 'bg-zinc-900 dark:bg-zinc-100 border-zinc-900 dark:border-zinc-100 text-white dark:text-zinc-900'
                : 'bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border-zinc-300 dark:border-zinc-600 opacity-0 group-hover:opacity-100 hover:border-zinc-500 dark:hover:border-zinc-400',
            )}
            onClick={handleCheckboxClick}
          >
            {isSelected && <Check size={12} strokeWidth={3} />}
          </button>
        </div>
      )}

      {showContextMenu && (
        <div className="absolute top-3 right-3 z-10">
          <PageContextMenu
            item={item}
            isFavorite={isFavorite}
            triggerClassName="item-action p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
            onRename={onRename}
            {...(onCopy ? { onCopy } : {})}
          />
        </div>
      )}

      <div
        className="h-28 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg mb-3 flex items-center justify-center text-zinc-300 dark:text-zinc-600 overflow-hidden"
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
          <Folder size={40} className="text-zinc-400 dark:text-zinc-500" />
        ) : item.icon ? (
          <span className="text-4xl drop-shadow-sm">{item.icon}</span>
        ) : (
          <FileText size={40} className="text-zinc-300 dark:text-zinc-600" />
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              maxLength={editLengthLimit * 2}
              value={editValue}
              onChange={(e) =>
                onEditChange?.(truncateUnicodeCodePoints(e.target.value, editLengthLimit))
              }
              onBlur={onEditSave}
              onKeyDown={onEditKeyDown}
              className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-zinc-900 dark:text-zinc-100"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50 text-sm truncate">
              {item.title || 'Untitled'}
            </h3>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              {item.type === 'folder' ? 'Folder' : `Edited ${formatDate(updatedDate)}`}
            </p>
          </div>
        </div>

        {collaborators.length > 0 && (
          <div className="shrink-0">
            <CollaboratorAvatars collaborators={collaborators} max={3} />
          </div>
        )}
      </div>
    </div>
    /* biome-ignore-end lint/a11y/useSemanticElements: nested buttons not possible */
  );
}
