import { Toolbar } from '@base-ui/react/toolbar';
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

const actionButtonClassName =
  'flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 rounded-lg transition-colors text-sm cursor-pointer aria-disabled:opacity-30 aria-disabled:cursor-default aria-disabled:hover:bg-transparent';
const regularActionButtonClassName = `${actionButtonClassName} hover:bg-zinc-100 dark:hover:bg-zinc-800`;
const removeActionButtonClassName = `${actionButtonClassName} hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400`;
const separatorClassName = 'hidden md:block w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1';

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
        className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 flex w-max max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1 px-3 py-2.5 sm:px-4 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 animate-slide-up"
      >
        {totalCount > 0 && (
          <Toolbar.Button
            type="button"
            onClick={allSelected ? onClear : onSelectAll}
            disabled={isRemoving}
            aria-label={allSelected ? 'Deselect all' : 'Select all'}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-sm cursor-pointer aria-disabled:opacity-50 aria-disabled:cursor-wait"
            title={allSelected ? 'Deselect all' : 'Select all'}
          >
            {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            <span className="hidden md:inline">{allSelected ? 'Deselect all' : 'Select all'}</span>
          </Toolbar.Button>
        )}
        {totalCount > 0 && <Toolbar.Separator className={separatorClassName} />}
        <span className="shrink-0 whitespace-nowrap text-sm font-medium px-2">
          {isRemoving
            ? `Removing ${selectedCount} item${selectedCount === 1 ? '' : 's'}…`
            : `${selectedCount} selected`}
        </span>
        <Toolbar.Separator className={separatorClassName} />
        <Toolbar.Button
          type="button"
          onClick={onCopy}
          disabled={!hasSelection || isRemoving}
          aria-label="Copy"
          className={regularActionButtonClassName}
          title="Copy"
        >
          <Copy size={14} />
          <span className="hidden md:inline">Copy</span>
        </Toolbar.Button>
        <Toolbar.Button
          type="button"
          onClick={onCut}
          disabled={!hasSelection || !canMove || isRemoving}
          aria-label="Cut"
          className={regularActionButtonClassName}
          title={canMove ? 'Cut' : 'Admin access is required to move selected items'}
        >
          <Scissors size={14} />
          <span className="hidden md:inline">Cut</span>
        </Toolbar.Button>
        <Toolbar.Button
          type="button"
          onClick={onMove}
          disabled={!hasSelection || !canMove || isRemoving}
          aria-label="Move"
          className={regularActionButtonClassName}
          title={canMove ? 'Move' : 'Admin access is required to move selected items'}
        >
          <FolderInput size={14} />
          <span className="hidden md:inline">Move</span>
        </Toolbar.Button>
        <Toolbar.Button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={!hasSelection || !canDelete || isRemoving}
          aria-label="Remove"
          className={removeActionButtonClassName}
          title={
            isRemoving
              ? 'Removing selected items'
              : canDelete
                ? 'Move owned items to Trash and remove shared items from your view'
                : 'Selected inherited items cannot be removed here'
          }
        >
          <Trash2 size={14} />
          <span className="hidden md:inline">Remove</span>
        </Toolbar.Button>
        <Toolbar.Button
          type="button"
          onClick={onPaste}
          disabled={clipboardCount === 0 || !canPaste || isRemoving}
          aria-label={`Paste ${clipboardCount} item${clipboardCount === 1 ? '' : 's'}`}
          className={regularActionButtonClassName}
          title={
            canPaste
              ? `Paste ${clipboardCount} item${clipboardCount !== 1 ? 's' : ''}`
              : 'Edit access is required to paste copies; moving requires Admin access'
          }
        >
          <ClipboardPaste size={14} />
          <span className="hidden md:inline">Paste {clipboardCount > 0 ? clipboardCount : ''}</span>
        </Toolbar.Button>
        <Toolbar.Separator className={separatorClassName} />
        <Toolbar.Button
          type="button"
          onClick={onClear}
          disabled={isRemoving}
          aria-label="Deselect all"
          className="shrink-0 rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer aria-disabled:opacity-50 aria-disabled:cursor-wait"
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
