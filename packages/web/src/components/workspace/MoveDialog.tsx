import { FloatingPortal } from '@floating-ui/react';
import type { FolderTreeNode } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight, Folder, Home } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { actionColors } from '../ui/ActionColors.stylex';
import { styles as frame } from '../ui/ModalFrame.stylex';
import { styles } from './MoveDialog.stylex';

interface MoveDialogProps {
  isOpen: boolean;
  folders: FolderTreeNode[];
  onClose: () => void;
  onConfirm: (folderId: string | null) => void;
  isLoading?: boolean;
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
  isLoading = false,
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
          className={
            stylex.props(
              styles.folderRow,
              selectedFolderId === folder.id && styles.selected,
              isDisabled && styles.disabled,
            ).className
          }
          data-move-selected={selectedFolderId === folder.id ? '' : undefined}
          data-move-disabled={isDisabled ? '' : undefined}
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
              {...stylex.props(styles.expandButton)}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span {...stylex.props(styles.expandPlaceholder)} />
          )}
          <button
            type="button"
            {...stylex.props(styles.folderButton, isDisabled && styles.folderButtonDisabled)}
            disabled={isDisabled}
            onClick={() => setSelectedFolderId(folder.id)}
          >
            <Folder size={16} />
            <span {...stylex.props(styles.folderName)}>{folder.name}</span>
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
        className={stylex.props(frame.overlay, frame.raisedOverlay).className}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div {...stylex.props(frame.panel, styles.content)}>
          <h2 {...stylex.props(styles.title)}>Move to</h2>
          <p {...stylex.props(styles.description)}>Select a destination folder</p>

          <div {...stylex.props(styles.destinationList)}>
            <button
              type="button"
              {...stylex.props(
                styles.rootRow,
                selectedFolderId === null && allowRoot
                  ? styles.selected
                  : !allowRoot
                    ? styles.disabled
                    : null,
              )}
              data-move-selected={selectedFolderId === null && allowRoot ? '' : undefined}
              data-move-disabled={!allowRoot ? '' : undefined}
              disabled={!allowRoot}
              title={allowRoot ? undefined : 'You need admin access to this workspace root'}
              onClick={() => setSelectedFolderId(null)}
            >
              <Home size={16} />
              <span {...stylex.props(styles.rootName)}>Root</span>
            </button>
            {isLoading ? (
              <p role="status" {...stylex.props(styles.loading)}>
                Loading destinations…
              </p>
            ) : (
              folders.map((folder) => renderFolder(folder))
            )}
          </div>

          <div {...stylex.props(styles.actions)}>
            <button type="button" onClick={onClose} {...stylex.props(styles.cancelButton)}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onConfirm(selectedFolderId)}
              disabled={isLoading || (selectedFolderId === null && !allowRoot)}
              {...stylex.props(actionColors.contrast, styles.confirmButton)}
            >
              Move here
            </button>
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
}
