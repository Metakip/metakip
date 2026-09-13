import type { ShareEntityType } from '@metakip/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentityLifecycle } from '../contexts/IdentityLifecycleContext';
import { isBulkRemovalInProgress } from '../utils/bulkRemovalState';

const API_BASE = '/api';

export interface Favorite {
  entityType: ShareEntityType;
  entityId: string;
  pageId?: string;
  title: string;
  icon: string | null;
  ownerId?: string | null;
  shareSource?: 'direct' | 'public' | 'workspace';
  createdAt: string | null;
}

async function fetchFavorites(): Promise<Favorite[]> {
  const res = await fetch(`${API_BASE}/favorites`);
  if (!res.ok) {
    throw new Error('Failed to fetch favorites');
  }
  const data = (await res.json()) as { favorites: Favorite[] };
  return data.favorites.map((favorite) => ({
    ...favorite,
    entityType: favorite.entityType ?? 'page',
    entityId: favorite.entityId ?? favorite.pageId ?? '',
    ...(favorite.pageId !== undefined ? { pageId: favorite.pageId } : {}),
  }));
}

async function addFavorite(entityType: ShareEntityType, entityId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/favorites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType, entityId }),
  });
  if (!res.ok) {
    throw new Error('Failed to add favorite');
  }
}

async function removeFavorite(entityType: ShareEntityType, entityId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/favorites/${entityType}/${entityId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Failed to remove favorite');
  }
}

export function useFavorites({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['favorites'],
    queryFn: () => fetchFavorites(),
    enabled,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

type ToggleFavoriteVariables = {
  entityType?: ShareEntityType;
  entityId?: string;
  pageId?: string;
  title?: string;
  icon?: string | null;
  ownerId?: string | null;
  isFavorite: boolean;
};

export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const identityLifecycle = useIdentityLifecycle();

  return useMutation({
    mutationFn: async ({
      entityType = 'page',
      entityId,
      pageId,
      isFavorite,
    }: ToggleFavoriteVariables) => {
      if (!identityLifecycle.isActive()) {
        throw new Error('Identity retired before favorite update');
      }
      const id = entityId ?? pageId;
      if (!id) {
        throw new Error('entityId is required');
      }
      if (isFavorite) {
        await removeFavorite(entityType, id);
      } else {
        await addFavorite(entityType, id);
      }
    },
    onMutate: async ({
      entityType = 'page',
      entityId,
      pageId,
      title,
      icon,
      ownerId,
      isFavorite,
    }: ToggleFavoriteVariables) => {
      const id = entityId ?? pageId;
      if (!id) return { previousFavorites: undefined };

      await queryClient.cancelQueries({ queryKey: ['favorites'] });
      if (!identityLifecycle.isActive()) {
        throw new Error('Identity retired during favorite update');
      }
      const previousFavorites = queryClient.getQueryData<Favorite[]>(['favorites']);
      const key = `${entityType}:${id}`;
      queryClient.setQueryData<Favorite[]>(['favorites'], (old) => {
        const current = old ?? [];
        if (isFavorite) {
          return current.filter(
            (favorite) => `${favorite.entityType}:${favorite.entityId}` !== key,
          );
        }
        if (current.some((favorite) => `${favorite.entityType}:${favorite.entityId}` === key)) {
          return current;
        }
        return [
          {
            entityType,
            entityId: id,
            ...(entityType === 'page' ? { pageId: id } : {}),
            title: title ?? 'Untitled',
            icon: icon ?? null,
            ownerId: ownerId ?? null,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ];
      });

      return { previousFavorites };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(['favorites'], context.previousFavorites ?? []);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
    meta: { errorMessage: 'Failed to update favorite' },
  });
}
