import type { FolderTreeNode } from '@metakip/shared';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockFolderTreeNode } from '../../test-utils/factories';
import { render } from '../../test-utils/render';
import { MoveDialog } from './MoveDialog';

function folder(overrides: Partial<FolderTreeNode>): FolderTreeNode {
  return createMockFolderTreeNode({
    ownerId: 'owner-1',
    userPermission: 'admin',
    ...overrides,
  });
}

describe('MoveDialog', () => {
  it('shows only destinations belonging to the moving entity owner', () => {
    render(
      <MoveDialog
        isOpen
        folders={[
          folder({ id: 'same-owner', name: 'Same workspace' }),
          folder({ id: 'other-owner', name: 'Other workspace', ownerId: 'owner-2' }),
        ]}
        movingOwnerId="owner-1"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('Same workspace')).toBeInTheDocument();
    expect(screen.queryByText('Other workspace')).not.toBeInTheDocument();
  });

  it.each([
    ['view', 'Viewer destination'],
    ['edit', 'Editor destination'],
  ] as const)('disables a %s destination', (permission, name) => {
    render(
      <MoveDialog
        isOpen
        folders={[folder({ id: permission, name, userPermission: permission })]}
        movingOwnerId="owner-1"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name })).toBeDisabled();
  });

  it('allows an admin destination and submits its folder ID', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <MoveDialog
        isOpen
        folders={[folder({ id: 'admin-folder', name: 'Admin destination' })]}
        movingOwnerId="owner-1"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Admin destination' }));
    await user.click(screen.getByRole('button', { name: 'Move here' }));

    expect(onConfirm).toHaveBeenCalledWith('admin-folder');
  });

  it('disables the workspace root without owner or workspace-admin access', () => {
    render(
      <MoveDialog isOpen folders={[]} allowRoot={false} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Root' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move here' })).toBeDisabled();
  });

  it('blocks a moving folder and all of its descendants', async () => {
    const child = folder({ id: 'child', parentId: 'moving', name: 'Child folder' });
    const moving = folder({
      id: 'moving',
      name: 'Moving folder',
      children: [child],
    });
    render(
      <MoveDialog
        isOpen
        folders={[moving]}
        movingFolderIds={['moving']}
        movingOwnerId="owner-1"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Moving folder' })).toBeDisabled();
    const expandButton = screen
      .getAllByRole('button')
      .find((button) => button.querySelector('svg.lucide-chevron-right'));
    expect(expandButton).toBeDefined();
    fireEvent.click(expandButton as HTMLButtonElement);
    expect(screen.getByRole('button', { name: 'Child folder' })).toBeDisabled();
  });
});
