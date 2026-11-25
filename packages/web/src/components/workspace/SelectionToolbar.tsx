import { Toolbar } from '@base-ui/react/toolbar';
import * as stylex from '@stylexjs/stylex';
import {
  CheckSquare,
  ClipboardPaste,
  Copy,
  FolderInput,
  Scissors,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { styles } from './SelectionToolbar.stylex';

interface SelectionToolbarProps {
  selectedCount: number;
  totalCount: number;
  clipboardCount: number;
  trashCount: number;
  removeFromViewCount: number;
  unremovableCount?: number;
  removalFailureMessage?: string | null;
  canRetryRemoval?: boolean;
  onDelete: () => void;
  onDismissRemovalFailure?: () => void;
  onCopy: () => void;
  onCut: () => void;
  onMove: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  canDelete?: boolean;
  canMove?: boolean;
  canPaste?: boolean;
  isRemoving?: boolean;
}

export function SelectionToolbar({
  selectedCount,
  totalCount,
  clipboardCount,
  trashCount,
  removeFromViewCount,
  unremovableCount = 0,
  removalFailureMessage = null,
  canRetryRemoval = false,
  onDelete,
  onDismissRemovalFailure,
  onCopy,
  onCut,
  onMove,
  onPaste,
  onSelectAll,
  onClear,
  canDelete = true,
  canMove = true,
  canPaste = true,
  isRemoving = false,
}: SelectionToolbarProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  if (selectedCount === 0 && clipboardCount === 0) return null;

  const allSelected = selectedCount === totalCount && totalCount > 0;
  const hasSelection = selectedCount > 0;
  const copyDisabled = !hasSelection || isRemoving;
  const moveDisabled = !hasSelection || !canMove || isRemoving;
  const removeDisabled = !hasSelection || !canDelete || isRemoving;
  const pasteDisabled = clipboardCount === 0 || !canPaste || isRemoving;
  const removalOutcomes = [
    trashCount > 0
      ? `${trashCount} item${trashCount === 1 ? '' : 's'} will be moved to Trash.`
      : '',
    removeFromViewCount > 0
      ? `${removeFromViewCount} item${removeFromViewCount === 1 ? '' : 's'} will be removed from your view.`
      : '',
    unremovableCount > 0
      ? `${unremovableCount} inherited item${unremovableCount === 1 ? '' : 's'} cannot be removed here and will remain selected.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <Toolbar.Root
        aria-label="Selection actions"
        {...stylex.props(styles.toolbar)}
        data-selection-toolbar=""
      >
        {totalCount > 0 && (
          <Toolbar.Button
            type="button"
            onClick={allSelected ? onClear : onSelectAll}
            disabled={isRemoving}
            aria-label={allSelected ? 'Deselect all' : 'Select all'}
            {...stylex.props(styles.selectButton, isRemoving && styles.pendingDisabled)}
            data-selection-pending=""
            title={allSelected ? 'Deselect all' : 'Select all'}
          >
            {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            <span {...stylex.props(styles.responsiveLabel)}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </span>
          </Toolbar.Button>
        )}
        {totalCount > 0 && (
          <Toolbar.Separator className={stylex.props(styles.separator).className} />
        )}
        <span {...stylex.props(styles.selectionCount)}>
          {isRemoving
            ? `Removing ${selectedCount} item${selectedCount === 1 ? '' : 's'}…`
            : `${selectedCount} selected`}
        </span>
        <Toolbar.Separator className={stylex.props(styles.separator).className} />
        <Toolbar.Button
          type="button"
          onClick={onCopy}
          disabled={copyDisabled}
          aria-label="Copy"
          {...stylex.props(styles.actionButton, copyDisabled && styles.disabledActionButton)}
          data-selection-action=""
          title="Copy"
        >
          <Copy size={14} />
          <span {...stylex.props(styles.responsiveLabel)}>Copy</span>
        </Toolbar.Button>
        <Toolbar.Button
          type="button"
          onClick={onCut}
          disabled={moveDisabled}
          aria-label="Cut"
          {...stylex.props(styles.actionButton, moveDisabled && styles.disabledActionButton)}
          data-selection-action=""
          title={canMove ? 'Cut' : 'Admin access is required to move selected items'}
        >
          <Scissors size={14} />
          <span {...stylex.props(styles.responsiveLabel)}>Cut</span>
        </Toolbar.Button>
        <Toolbar.Button
          type="button"
          onClick={onMove}
          disabled={moveDisabled}
          aria-label="Move"
          {...stylex.props(styles.actionButton, moveDisabled && styles.disabledActionButton)}
          data-selection-action=""
          title={canMove ? 'Move' : 'Admin access is required to move selected items'}
        >
          <FolderInput size={14} />
          <span {...stylex.props(styles.responsiveLabel)}>Move</span>
        </Toolbar.Button>
        <Toolbar.Button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={removeDisabled}
          aria-label="Remove"
          {...stylex.props(
            styles.actionButton,
            styles.removeButton,
            removeDisabled && styles.disabledActionButton,
          )}
          data-selection-action=""
          data-selection-remove=""
          title={
            isRemoving
              ? 'Removing selected items'
              : canDelete
                ? 'Move owned items to Trash and remove shared items from your view'
                : 'Selected inherited items cannot be removed here'
          }
        >
          <Trash2 size={14} />
          <span {...stylex.props(styles.responsiveLabel)}>Remove</span>
        </Toolbar.Button>
        <Toolbar.Button
          type="button"
          onClick={onPaste}
          disabled={pasteDisabled}
          aria-label={`Paste ${clipboardCount} item${clipboardCount === 1 ? '' : 's'}`}
          {...stylex.props(styles.actionButton, pasteDisabled && styles.disabledActionButton)}
          data-selection-action=""
          title={
            canPaste
              ? `Paste ${clipboardCount} item${clipboardCount !== 1 ? 's' : ''}`
              : 'Edit access is required to paste copies; moving requires Admin access'
          }
        >
          <ClipboardPaste size={14} />
          <span {...stylex.props(styles.responsiveLabel)}>
            Paste {clipboardCount > 0 ? clipboardCount : ''}
          </span>
        </Toolbar.Button>
        <Toolbar.Separator className={stylex.props(styles.separator).className} />
        <Toolbar.Button
          type="button"
          onClick={onClear}
          disabled={isRemoving}
          aria-label="Deselect all"
          {...stylex.props(styles.clearButton, isRemoving && styles.pendingDisabled)}
          data-selection-pending=""
          title="Deselect all"
        >
          <X size={16} />
        </Toolbar.Button>
      </Toolbar.Root>
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Remove selected items?"
        message={`${removalOutcomes} Folders moved to Trash include their contents.`}
        confirmText="Remove items"
        onConfirm={() => {
          setShowDeleteConfirm(false);
          onDelete();
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
      <ConfirmDialog
        isOpen={removalFailureMessage !== null}
        title="Some items could not be removed"
        message={removalFailureMessage ?? ''}
        confirmText={canRetryRemoval ? 'Retry failed items' : 'Close'}
        cancelText="Close"
        showCancel={canRetryRemoval}
        loading={isRemoving}
        loadingText="Retrying..."
        onConfirm={canRetryRemoval ? onDelete : () => onDismissRemovalFailure?.()}
        onCancel={() => onDismissRemovalFailure?.()}
      />
    </>
  );
}
