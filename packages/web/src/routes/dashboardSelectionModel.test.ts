import { describe, expect, it } from 'vitest';
import type { ExplorerItemData } from '../components/workspace/ExplorerItem';
import {
  resolveDashboardShiftSelection,
  retainVisibleDashboardSelection,
} from './dashboardSelectionModel';

const ITEMS: ExplorerItemData[] = [
  { id: 'page-a', type: 'page', title: 'Page A', updatedAt: new Date('2026-01-01') },
  { id: 'page-b', type: 'page', title: 'Page B', updatedAt: new Date('2026-01-01') },
];

describe('resolveDashboardShiftSelection', () => {
  it('navigates when shift-click has no selection anchor', () => {
    expect(
      resolveDashboardShiftSelection({
        anchor: null,
        index: 0,
        items: ITEMS,
        section: 'all-items',
      }),
    ).toEqual({ kind: 'navigate' });
  });

  it('selects a single item when shift-click crosses dashboard sections', () => {
    expect(
      resolveDashboardShiftSelection({
        anchor: { index: 0, section: 'starred' },
        index: 1,
        items: ITEMS,
        section: 'all-items',
      }),
    ).toEqual({ kind: 'select' });
  });

  it('drops selection for a starred item that is no longer visible', () => {
    expect(
      retainVisibleDashboardSelection(
        [
          { id: 'visible-page', type: 'page' },
          { id: 'unstarred-page', type: 'page' },
        ],
        new Set(['page:visible-page']),
      ),
    ).toEqual([{ id: 'visible-page', type: 'page' }]);
  });
});
