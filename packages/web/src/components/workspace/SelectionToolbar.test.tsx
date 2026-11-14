import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionToolbar } from './SelectionToolbar';

const handlers = {
  onDelete: vi.fn(),
  onCopy: vi.fn(),
  onCut: vi.fn(),
  onMove: vi.fn(),
  onPaste: vi.fn(),
  onSelectAll: vi.fn(),
  onClear: vi.fn(),
};

describe('SelectionToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows removal progress and disables actions', () => {
    render(
      <SelectionToolbar
        selectedCount={14}
        totalCount={14}
        clipboardCount={2}
        trashCount={8}
        removeFromViewCount={6}
        isRemoving
        {...handlers}
      />,
    );

    expect(screen.getByRole('toolbar', { name: 'Selection actions' })).toBeInTheDocument();
    expect(screen.getByText('Removing 14 items…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveAttribute('aria-disabled', 'true');
    for (const button of screen.getAllByRole('button', { name: 'Deselect all' })) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('confirms the exact Trash and personal-removal outcomes', async () => {
    const user = userEvent.setup();
    render(
      <SelectionToolbar
        selectedCount={3}
        totalCount={5}
        clipboardCount={0}
        trashCount={1}
        removeFromViewCount={2}
        {...handlers}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByText(/1 item will be moved to Trash/)).toBeInTheDocument();
    expect(screen.getByText(/2 items will be removed from your view/)).toBeInTheDocument();
    expect(handlers.onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove items' }));
    expect(handlers.onDelete).toHaveBeenCalledOnce();
  });

  it('keeps ineligible and failed items visible with a retry action', async () => {
    const user = userEvent.setup();
    const onDismissRemovalFailure = vi.fn();
    const { rerender } = render(
      <SelectionToolbar
        selectedCount={3}
        totalCount={5}
        clipboardCount={0}
        trashCount={1}
        removeFromViewCount={1}
        unremovableCount={1}
        {...handlers}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText(/1 inherited item cannot be removed here/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    rerender(
      <SelectionToolbar
        selectedCount={1}
        totalCount={5}
        clipboardCount={0}
        trashCount={1}
        removeFromViewCount={0}
        removalFailureMessage="2 of 3 items were removed. 1 item could not be removed."
        canRetryRemoval
        onDismissRemovalFailure={onDismissRemovalFailure}
        {...handlers}
      />,
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Some items could not be removed');
    await user.click(screen.getByRole('button', { name: 'Retry failed items' }));
    expect(handlers.onDelete).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDismissRemovalFailure).toHaveBeenCalledOnce();
  });
});
