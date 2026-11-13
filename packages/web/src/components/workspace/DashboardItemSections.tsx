import type React from 'react';
import type { DashboardSection } from '../../routes/dashboardSelectionModel';
import { canRenameEntity } from '../../utils/entity-actions';
import { ExplorerItem, type ExplorerItemData } from './ExplorerItem';

export type { DashboardSection } from '../../routes/dashboardSelectionModel';

type EditingTarget = {
  kind: 'page' | 'folder';
  id: string;
  section: DashboardSection;
  value: string;
} | null;

interface DashboardItemSectionsProps {
  allItems: ExplorerItemData[];
  canSelect: boolean;
  currentUserId: string | undefined;
  editingTarget: EditingTarget;
  starredItems: ExplorerItemData[];
  hasSelection: boolean;
  isEditingAllowed: boolean;
  isStarred: (item: ExplorerItemData) => boolean;
  isSelected: (id: string) => boolean;
  onEditChange: (value: string) => void;
  onEditKeyDown: (event: React.KeyboardEvent) => void;
  onEditSave: () => void;
  onNavigate: (
    item: ExplorerItemData,
    index: number,
    event: React.MouseEvent | React.KeyboardEvent,
    items: readonly ExplorerItemData[],
    section: DashboardSection,
  ) => void;
  onRename: (item: ExplorerItemData, section: DashboardSection) => void;
  onSelect: (item: ExplorerItemData, event: React.MouseEvent | React.KeyboardEvent) => void;
  viewMode: 'card' | 'list';
}

function ItemSection({
  title,
  items,
  section,
  canSelect,
  currentUserId,
  editingTarget,
  hasSelection,
  isEditingAllowed,
  isStarred,
  isSelected,
  onEditChange,
  onEditKeyDown,
  onEditSave,
  onNavigate,
  onRename,
  onSelect,
  viewMode,
}: DashboardItemSectionsProps & {
  title?: string;
  items: ExplorerItemData[];
  section: DashboardSection;
}) {
  const explorerItems = items.map((item, index) => (
    <ExplorerItem
      key={`${item.type}-${item.id}`}
      item={item}
      viewMode={viewMode}
      isSelected={isSelected(item.id)}
      isStarred={isStarred(item)}
      canSelect={canSelect}
      onSelect={(event) => onSelect(item, event)}
      onNavigate={(event) => onNavigate(item, index, event, items, section)}
      {...(canRenameEntity(item, currentUserId) ? { onRename: () => onRename(item, section) } : {})}
      isEditing={
        isEditingAllowed &&
        editingTarget?.kind === item.type &&
        editingTarget.id === item.id &&
        editingTarget.section === section
      }
      editValue={editingTarget?.value ?? ''}
      onEditChange={onEditChange}
      onEditSave={onEditSave}
      onEditKeyDown={onEditKeyDown}
      collaborators={
        currentUserId
          ? (item.collaborators ?? []).filter(
              (collaborator) => collaborator.userId !== currentUserId,
            )
          : (item.collaborators ?? [])
      }
      {...(viewMode === 'list' ? { showCheckboxes: hasSelection } : {})}
    />
  ));

  return (
    <div>
      {title && (
        <h2 className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3 px-1">
          {title}
        </h2>
      )}
      {viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{explorerItems}</div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-clip">
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-4 py-2 text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
            <span className="w-8" />
            <span className="-ml-10">Name</span>
            <span className="hidden md:block w-28">Shared with</span>
            <span className="hidden md:block w-36">Last edited</span>
            <span className="w-8" />
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{explorerItems}</div>
        </div>
      )}
    </div>
  );
}

export function DashboardItemSections(props: DashboardItemSectionsProps) {
  const { allItems, starredItems } = props;
  return (
    <div className={props.viewMode === 'card' ? 'space-y-8 animate-fade-in' : 'space-y-8'}>
      {starredItems.length > 0 && (
        <ItemSection {...props} title="Starred" items={starredItems} section="starred" />
      )}
      {allItems.length > 0 && (
        <ItemSection
          {...props}
          {...(starredItems.length > 0 ? { title: 'All Items' } : {})}
          items={allItems}
          section="all-items"
        />
      )}
    </div>
  );
}
