import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ExplorerItem, ExplorerItemData } from './ExplorerItem';

vi.mock('./ExplorerItem', () => ({
  ExplorerItem: ({ item, edit, onRename }: ComponentProps<typeof ExplorerItem>) => (
    <button type="button" onClick={onRename}>
      {`${item.title}: ${edit ? 'editing' : 'idle'}`}
    </button>
  ),
}));

import { ExplorerItemSections } from './ExplorerItemSections';

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
  section: 'starred' | 'all-items';
  value: string;
} | null;

function RenameHarness() {
  const [editingTarget, setEditingTarget] = useState<EditingTarget>(null);
  return (
    <ExplorerItemSections
      sections={[
        { id: 'starred', title: 'Starred', items: [ITEM] },
        { id: 'all-items', title: 'All Items', items: [ITEM] },
      ]}
      viewMode="list"
      currentUserId="current-user"
      canSelect
      hasSelection={false}
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

describe('ExplorerItemSections', () => {
  it('edits only the selected section when an item appears in more than one section', async () => {
    const user = userEvent.setup();
    render(<RenameHarness />);

    const starredRename = screen.getAllByRole('button', { name: 'Starred page: idle' }).at(0);
    if (!starredRename) throw new Error('Starred rename action was not rendered');
    await user.click(starredRename);

    expect(screen.getAllByRole('button', { name: 'Starred page: editing' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Starred page: idle' })).toHaveLength(1);
  });
});
