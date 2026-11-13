import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ExplorerItemData } from './ExplorerItem';

type MockExplorerItemProps = {
  isEditing?: boolean;
  item: ExplorerItemData;
  onRename?: () => void;
};

vi.mock('./ExplorerItem', () => ({
  ExplorerItem: ({ item, isEditing = false, onRename }: MockExplorerItemProps) => (
    <button type="button" onClick={onRename}>
      {`${item.title}: ${isEditing ? 'editing' : 'idle'}`}
    </button>
  ),
}));

import { DashboardItemSections, type DashboardSection } from './DashboardItemSections';

const ITEM: ExplorerItemData = {
  id: 'starred-page',
  type: 'page',
  title: 'Starred page',
  updatedAt: new Date('2026-01-01'),
  ownerId: 'current-user',
};

type EditingTarget = {
  kind: 'page' | 'folder';
  id: string;
  section: DashboardSection;
  value: string;
} | null;

function RenameHarness() {
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  return (
    <DashboardItemSections
      allItems={[ITEM]}
      starredItems={[ITEM]}
      viewMode="list"
      currentUserId="current-user"
      canSelect
      hasSelection={false}
      isEditingAllowed
      editingTarget={editingTarget}
      isStarred={() => true}
      isSelected={() => false}
      onSelect={() => {}}
      onNavigate={() => {}}
      onRename={(item, section) =>
        setEditingTarget({ kind: item.type, id: item.id, section, value: item.title })
      }
      onEditChange={() => {}}
      onEditKeyDown={() => {}}
      onEditSave={() => {}}
    />
  );
}

describe('DashboardItemSections', () => {
  it('edits only the selected section when a starred item also appears in all items', async () => {
    const user = userEvent.setup();
    render(<RenameHarness />);

    const starredRename = screen.getAllByRole('button', { name: 'Starred page: idle' }).at(0);
    if (!starredRename) throw new Error('Starred rename action was not rendered');
    await user.click(starredRename);

    expect(screen.getAllByRole('button', { name: 'Starred page: editing' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Starred page: idle' })).toHaveLength(1);
  });
});
