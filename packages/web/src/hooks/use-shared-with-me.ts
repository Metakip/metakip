import type { SharedNavigationItem, SharedWithMeItem } from '@metakip/shared';
import { useQuery } from '@tanstack/react-query';
import { isBulkRemovalInProgress } from '../utils/bulkRemovalState';

const API_BASE = '/api';

async function fetchSharedWithMe(limit?: number): Promise<SharedWithMeItem[]> {
  const searchParams = new URLSearchParams();
  if (limit !== undefined) {
    searchParams.set('limit', String(limit));
  }
  const query = searchParams.toString();
  const res = await fetch(`${API_BASE}/shares/with-me${query ? `?${query}` : ''}`);
  if (!res.ok) {
    throw new Error('Failed to fetch shared content');
  }
  return res.json();
}

async function fetchSharedWithMeTree(limit?: number): Promise<SharedNavigationItem[]> {
  const searchParams = new URLSearchParams();
  if (limit !== undefined) {
    searchParams.set('limit', String(limit));
  }
  const query = searchParams.toString();
  const res = await fetch(`${API_BASE}/shares/with-me/tree${query ? `?${query}` : ''}`);
  if (!res.ok) {
    throw new Error('Failed to fetch shared navigation');
  }
  return res.json();
}

export function useSharedWithMe(limit?: number) {
  return useQuery({
    queryKey: limit === undefined ? ['shared-with-me'] : ['shared-with-me', limit],
    queryFn: () => fetchSharedWithMe(limit),
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

export function useSharedWithMeTree(limit?: number) {
  return useQuery({
    queryKey: limit === undefined ? ['shared-with-me', 'tree'] : ['shared-with-me', 'tree', limit],
    queryFn: () => fetchSharedWithMeTree(limit),
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}
