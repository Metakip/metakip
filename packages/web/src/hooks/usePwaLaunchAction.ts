import { useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { getWorkspaceRootPath } from '../utils/url';
import { useEntityCreationActions } from './useEntityCreationActions';

export function usePwaLaunchAction(): boolean {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { createPageAndNavigate } = useEntityCreationActions();
  const handledAction = useRef<'search' | 'new-page' | null>(null);
  const action = location.pathname === getWorkspaceRootPath() ? searchParams.get('action') : null;

  useEffect(() => {
    if (action !== 'search' && action !== 'new-page') {
      handledAction.current = null;
      return;
    }
    if (handledAction.current === action) return;

    handledAction.current = action;
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete('action');
    setSearchParams(nextSearchParams, { replace: true });

    if (action === 'new-page') {
      void createPageAndNavigate().catch(() => {
        // Error toast handled globally by MutationCache.onError
      });
    }
  }, [action, createPageAndNavigate, searchParams, setSearchParams]);

  return action === 'search';
}
