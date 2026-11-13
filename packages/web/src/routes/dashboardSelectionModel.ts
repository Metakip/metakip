import type { ExplorerItemData } from '../components/workspace/ExplorerItem';
import type { SelectionItem } from '../contexts/SelectionContext';

export type DashboardSection = 'all-items' | 'starred';

export type DashboardSelectionAnchor = {
  index: number;
  section: DashboardSection;
};

export type DashboardShiftSelection =
  | { kind: 'navigate' }
  | { kind: 'select' }
  | { items: Array<{ id: string; type: 'page' | 'folder' }>; kind: 'range' };

export function resolveDashboardShiftSelection({
  anchor,
  index,
  items,
  section,
}: {
  anchor: DashboardSelectionAnchor | null;
  index: number;
  items: readonly ExplorerItemData[];
  section: DashboardSection;
}): DashboardShiftSelection {
  if (!anchor) return { kind: 'navigate' };
  if (anchor.section !== section) return { kind: 'select' };

  const start = Math.min(anchor.index, index);
  const end = Math.max(anchor.index, index);
  return {
    kind: 'range',
    items: items.slice(start, end + 1).map((item) => ({ id: item.id, type: item.type })),
  };
}

export function retainVisibleDashboardSelection(
  selectedItems: readonly SelectionItem[],
  visibleItemKeys: ReadonlySet<string>,
): SelectionItem[] {
  return selectedItems.filter((item) => visibleItemKeys.has(`${item.type}:${item.id}`));
}
