import * as stylex from '@stylexjs/stylex';
import type React from 'react';
import { canRenameEntity } from '../../utils/entity-actions';
import { ExplorerItem, type ExplorerItemData } from './ExplorerItem';
import { styles } from './ExplorerItemSections.stylex';

type ExplorerItemSection<TSection extends string> = {
  id: TSection;
  title?: string;
  items: readonly ExplorerItemData[];
};

type EditingTarget<TSection extends string> = {
  kind: 'page' | 'folder';
  id: string;
  section: TSection;
  value: string;
} | null;

interface ExplorerItemSectionsProps<TSection extends string> {
  sections: readonly ExplorerItemSection<TSection>[];
  canSelect: boolean;
  currentUserId: string | undefined;
  showContextMenu?: boolean;
  editingTarget: EditingTarget<TSection>;
  hasSelection: boolean;
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
    section: TSection,
  ) => void;
  onRename: (item: ExplorerItemData, section: TSection) => void;
  onSelect: (item: ExplorerItemData, event: React.MouseEvent | React.KeyboardEvent) => void;
  viewMode: 'card' | 'list';
  animation?: 'fast' | 'standard';
}

export function ExplorerItemSections<TSection extends string>({
  sections,
  animation,
  canSelect,
  currentUserId,
  showContextMenu = true,
  editingTarget,
  hasSelection,
  isStarred,
  isSelected,
  onEditChange,
  onEditKeyDown,
  onEditSave,
  onNavigate,
  onRename,
  onSelect,
  viewMode,
}: ExplorerItemSectionsProps<TSection>) {
  const visibleSections = sections.filter((section) => section.items.length > 0);
  return (
    <div
      {...stylex.props(
        styles.sections,
        animation === 'fast' && styles.animateFast,
        animation === 'standard' && styles.animateStandard,
      )}
    >
      {visibleSections.map((section) => {
        const items = section.items.map((item, index) => (
          <ExplorerItem
            key={`${item.type}-${item.id}`}
            item={item}
            viewMode={viewMode}
            isSelected={isSelected(item.id)}
            isStarred={isStarred(item)}
            canSelect={canSelect}
            showContextMenu={showContextMenu}
            onSelect={(event) => onSelect(item, event)}
            onNavigate={(event) => onNavigate(item, index, event, section.items, section.id)}
            {...(canRenameEntity(item, currentUserId)
              ? { onRename: () => onRename(item, section.id) }
              : {})}
            edit={
              editingTarget?.kind === item.type &&
              editingTarget.id === item.id &&
              editingTarget.section === section.id
                ? {
                    value: editingTarget.value,
                    onChange: onEditChange,
                    onSave: onEditSave,
                    onKeyDown: onEditKeyDown,
                  }
                : null
            }
            collaborators={(item.collaborators ?? []).filter(
              (collaborator) => collaborator.userId !== currentUserId,
            )}
            showCheckboxes={hasSelection}
          />
        ));

        return (
          <section key={section.id}>
            {section.title && <h2 {...stylex.props(styles.sectionTitle)}>{section.title}</h2>}
            {viewMode === 'card' ? (
              <div {...stylex.props(styles.cardGrid)}>{items}</div>
            ) : (
              <div {...stylex.props(styles.listContainer)}>
                <div {...stylex.props(styles.listHeader)}>
                  <span {...stylex.props(styles.listSpacer)} />
                  <span {...stylex.props(styles.listName)}>Name</span>
                  <span {...stylex.props(styles.optionalColumn, styles.sharedColumn)}>
                    Shared with
                  </span>
                  <span {...stylex.props(styles.optionalColumn, styles.editedColumn)}>
                    Last edited
                  </span>
                  <span {...stylex.props(styles.listSpacer)} />
                </div>
                <div {...stylex.props(styles.listItems)}>{items}</div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
