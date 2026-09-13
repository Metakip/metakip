import { FloatingPortal } from '@floating-ui/react';
import type { FolderTreeNode } from '@metakip/shared';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Folder, Home } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

interface MoveDialogProps {
  isOpen: boolean;
  folders: FolderTreeNode[];
  onClose: () => void;
  onConfirm: (folderId: string | null) => void;
  movingFolderIds?: string[];
  movingOwnerId?: string | null | undefined;
  allowRoot?: boolean;
}

const canMoveIntoFolder = (folder: FolderTreeNode): boolean => {
  if (folder.userPermission === undefined || folder.userPermission === null) {
    return true;
  }
  return folder.userPermission === 'admin';
};

export function MoveDialog({
  isOpen,
  folders,
  onClose,
  onConfirm,
  movingFolderIds = [],
  movingOwnerId,
  allowRoot = true,
}: MoveDialogProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const movingFolderIdSet = useMemo(() => new Set(movingFolderIds), [movingFolderIds]);
  const blockedFolderIds = useMemo(() => {
    const blocked = new Set<string>();

    const walk = (nodes: FolderTreeNode[], isInsideMovingFolder: boolean) => {
      for (const folder of nodes) {
        const isMovingFolder = movingFolderIdSet.has(folder.id);
        const isBlocked = isInsideMovingFolder || isMovingFolder;
        if (isBlocked) {
          blocked.add(folder.id);
        }
        walk(folder.children ?? [], isBlocked);
      }
    };

    walk(folders, false);
    return blocked;
  }, [folders, movingFolderIdSet]);

  useEffect(() => {
    if (isOpen) {
      setSelectedFolderId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (selectedFolderId && blockedFolderIds.has(selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }, [isOpen, selectedFolderId, blockedFolderIds]);

  if (!isOpen) return null;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderFolder = (folder: FolderTreeNode, depth = 0): ReactNode => {
    if (movingOwnerId !== undefined && folder.ownerId !== movingOwnerId) return null;

    const isExpanded = expandedIds.has(folder.id);
    const hasChildren = folder.children.length > 0;
    const isBlocked = blockedFolderIds.has(folder.id);
    const isWritable = canMoveIntoFolder(folder);
    const isDisabled = isBlocked || !isWritable;
    const disabledTitle = isBlocked
      ? 'Cannot move a folder into itself or one of its child folders'
      : !isWritable
        ? 'You need admin access to move items here'
        : undefined;

    return (
      <div key={folder.id}>
        <div
          className={clsx(
            'w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
            selectedFolderId === folder.id
              ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
              : isDisabled
                ? 'text-zinc-400 dark:text-zinc-600 opacity-60'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
          )}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
          title={disabledTitle}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(folder.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleExpand(folder.id);
                }
              }}
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-black/10 dark:hover:bg-white/10 shrink-0 cursor-pointer"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <button
            type="button"
            className={clsx(
              'flex-1 flex items-center gap-2 text-left text-inherit',
              isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
            )}
            disabled={isDisabled}
            onClick={() => setSelectedFolderId(folder.id)}
          >
            <Folder size={16} />
            <span className="text-sm truncate">{folder.name}</span>
          </button>
        </div>
        {isExpanded && folder.children.map((child) => renderFolder(child, depth + 1))}
      </div>
    );
  };

  return (
    <FloatingPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Move item"
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-900/40 backdrop-blur-sm px-4 animate-fade-in"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="w-full max-w-md rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 shadow-xl animate-slide-up flex flex-col max-h-[70vh] min-h-0">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Move to</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Select a destination folder
          </p>

          <div className="mt-4 flex-1 min-h-0 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded-lg p-2 space-y-1">
            <button
              type="button"
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors',
                selectedFolderId === null && allowRoot
                  ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                  : !allowRoot
                    ? 'text-zinc-400 dark:text-zinc-600 opacity-60 cursor-not-allowed'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
              )}
              disabled={!allowRoot}
              title={allowRoot ? undefined : 'You need admin access to this workspace root'}
              onClick={() => setSelectedFolderId(null)}
            >
              <Home size={16} />
              <span className="text-sm font-medium">Root</span>
            </button>
            {folders.map((folder) => renderFolder(folder))}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(selectedFolderId)}
              disabled={selectedFolderId === null && !allowRoot}
              className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              Move here
            </button>
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
}
