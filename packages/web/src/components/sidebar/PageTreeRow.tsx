import {
  MAX_FOLDER_NAME_LENGTH,
  MAX_PAGE_TITLE_LENGTH,
  type SharePermission,
  truncateUnicodeCodePoints,
} from '@metakip/shared';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useIdentityNavigate } from '../../contexts/IdentityLifecycleContext';
import { buildEntityPath, buildFolderPath, getWorkspacePath } from '../../utils/url';
import { PageContextMenu } from '../ui/PageContextMenu';

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
  isFavorite?: boolean;
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
  isFavorite = false,
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
      className={clsx(
        'group flex items-center h-8 pr-2 py-1 my-0.5 rounded-lg cursor-pointer transition-all duration-200 ease-in-out relative',
        isActive
          ? 'bg-black/5 dark:bg-white/10 text-zinc-900 dark:text-zinc-100 font-medium shadow-[0_1px_2px_rgba(0,0,0,0.02)]'
          : 'text-zinc-600 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-zinc-100',
        isDragTarget && 'opacity-60',
      )}
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
        className={clsx(
          'flex items-center justify-center w-5 h-5 rounded-md mr-2 transition-colors',
          showDragHandle ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          hasChildren
            ? 'hover:bg-black/10 dark:hover:bg-white/10 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300'
            : 'text-zinc-400 dark:text-zinc-500 opacity-50',
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
          <span className="text-sm leading-none">📁</span>
        ) : icon ? (
          <span className="text-sm leading-none">{icon}</span>
        ) : (
          <FileText
            size={14}
            className={clsx(
              isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500',
            )}
          />
        )}
      </button>

      <div
        className={clsx(
          'flex-1 flex items-center min-w-0 transition-[padding] duration-150',
          isMenuOpen ? 'pr-14' : 'pr-2 group-hover:pr-14',
        )}
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
            className="flex-1 bg-white/50 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-md px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 h-6 min-w-0 text-zinc-900 dark:text-zinc-100"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-sm leading-none pt-0.5">{title}</span>
        )}
      </div>

      {!isEditing && (
        <div
          className={clsx(
            'absolute right-1 z-20 flex items-center gap-0.5 transition-opacity',
            isMenuOpen
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
          )}
        >
          {onCreateChild && (
            <button
              type="button"
              onClick={handleCreateChild}
              className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors"
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
              ...(ownerId != null ? { ownerId } : {}),
              ...(createdBy != null ? { createdBy } : {}),
              ...(userPermission !== undefined ? { userPermission } : {}),
              ...(shareSource !== undefined ? { shareSource } : {}),
              ...(canMove !== undefined ? { canMove } : {}),
            }}
            isFavorite={isFavorite}
            triggerClassName="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer transition-colors"
            menuClassName="w-40 bg-white dark:bg-zinc-900 border border-black/5 dark:border-white/5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-2xl p-1.5 flex flex-col z-[9999]"
            onOpenChange={setIsMenuOpen}
            {...(onRename != null ? { onRename } : {})}
            {...(isActive
              ? {
                  onDeleted: () =>
                    navigate(parentId ? buildFolderPath('folder', parentId) : getWorkspacePath()),
                }
              : {})}
          />
        </div>
      )}
    </div>
  );
}
