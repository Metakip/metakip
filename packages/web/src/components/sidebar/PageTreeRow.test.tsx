import { MAX_FOLDER_NAME_LENGTH, MAX_PAGE_TITLE_LENGTH } from '@metakip/shared';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../test-utils/render';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('../../contexts/IdentityLifecycleContext', () => ({
  useIdentityNavigate: () => mocks.navigate,
}));

vi.mock('../ui/PageContextMenu', () => ({
  PageContextMenu: ({
    onOpenChange,
    onDeleted,
  }: {
    onOpenChange?: (open: boolean) => void;
    onDeleted?: () => void;
  }) => (
    <>
      <button
        type="button"
        aria-label="Open menu"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange?.(true);
        }}
      >
        Menu
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDeleted?.();
        }}
      >
        Complete removal
      </button>
    </>
  ),
}));

import { PageTreeRow } from './PageTreeRow';

describe('PageTreeRow keyboard actions', () => {
  it.each([
    ['page', false, '/entity-page-1'],
    ['folder', true, '/folder/entity-folder-1'],
  ] as const)('uses the canonical %s path when the row is activated', async (_type, isFolder, path) => {
    const user = userEvent.setup();
    mocks.navigate.mockReset();
    render(<PageTreeRow id={`${_type}-1`} title="Entity" isFolder={isFolder} />);

    await user.click(screen.getByTestId('page-tree-row'));

    expect(mocks.navigate).toHaveBeenCalledWith(path);
  });

  it('opens the action menu without activating row navigation', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<PageTreeRow id="page-1" title="Page" onNavigate={onNavigate} />);

    const menuButton = screen.getByRole('button', { name: 'Open menu' });
    menuButton.focus();
    await user.keyboard('{Enter}');

    expect(onNavigate).not.toHaveBeenCalled();
    expect(menuButton.parentElement).toHaveClass('opacity-100');
  });

  it('limits inline names by Unicode code point without splitting emoji', () => {
    const onEditChange = vi.fn();
    const { rerender } = render(
      <PageTreeRow id="folder-1" title="Folder" isFolder isEditing onEditChange={onEditChange} />,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'maxlength',
      String(MAX_FOLDER_NAME_LENGTH * 2),
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '📁'.repeat(MAX_FOLDER_NAME_LENGTH + 1) },
    });
    expect(onEditChange).toHaveBeenLastCalledWith('📁'.repeat(MAX_FOLDER_NAME_LENGTH));

    rerender(<PageTreeRow id="page-1" title="Page" isEditing />);
    expect(screen.getByRole('textbox')).toHaveAttribute(
      'maxlength',
      String(MAX_PAGE_TITLE_LENGTH * 2),
    );
  });

  it.each([
    ['page', false],
    ['folder', true],
  ] as const)('navigates an active removed %s to its parent folder', async (_type, isFolder) => {
    const user = userEvent.setup();
    mocks.navigate.mockReset();
    render(
      <PageTreeRow id="active-1" title="Active" parentId="folder-1" isFolder={isFolder} isActive />,
    );

    await user.click(screen.getByRole('button', { name: 'Complete removal' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/folder/folder-folder-1');
  });

  it('navigates an active top-level item Home after removal', async () => {
    const user = userEvent.setup();
    mocks.navigate.mockReset();
    render(<PageTreeRow id="folder-1" title="Folder" isFolder isActive />);

    await user.click(screen.getByRole('button', { name: 'Complete removal' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it.each([
    ['page', false],
    ['folder', true],
  ] as const)('keeps the current route after removing an inactive %s', async (_type, isFolder) => {
    const user = userEvent.setup();
    mocks.navigate.mockReset();
    render(<PageTreeRow id="inactive-1" title="Inactive" isFolder={isFolder} />);

    await user.click(screen.getByRole('button', { name: 'Complete removal' }));

    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
