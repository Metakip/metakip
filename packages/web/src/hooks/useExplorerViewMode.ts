import { useCallback, useState } from 'react';

export type ExplorerViewMode = 'card' | 'list';

export function useExplorerViewMode() {
  const [viewMode, setViewModeState] = useState<ExplorerViewMode>(() =>
    localStorage.getItem('metakip:viewMode') === 'list' ? 'list' : 'card',
  );

  const setViewMode = useCallback((mode: ExplorerViewMode) => {
    setViewModeState(mode);
    localStorage.setItem('metakip:viewMode', mode);
  }, []);

  return [viewMode, setViewMode] as const;
}
