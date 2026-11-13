import type { ShareEntityType } from '@metakip/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentityLifecycle } from '../contexts/IdentityLifecycleContext';
import { isBulkRemovalInProgress } from '../utils/bulkRemovalState';

const API_BASE = '/api';

export interface StarredEntity {
  entityType: ShareEntityType;
  entityId: string;
  title: string;
  icon: string | null;
  ownerId?: string | null;
  shareSource?: 'direct' | 'public' | 'workspace';
  createdAt: string | null;
}

async function fetchStars(): Promise<StarredEntity[]> {
  const res = await fetch(`${API_BASE}/stars`);
  if (!res.ok) {
    throw new Error('Failed to fetch stars');
  }
  const data = (await res.json()) as { stars: StarredEntity[] };
  return data.stars;
}

async function addStar(entityType: ShareEntityType, entityId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/stars`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType, entityId }),
  });
  if (!res.ok) {
    throw new Error('Failed to star item');
  }
}

async function removeStar(entityType: ShareEntityType, entityId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/stars/${entityType}/${entityId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Failed to unstar item');
  }
}

export function useStars({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['stars'],
    queryFn: fetchStars,
    enabled,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

type ToggleStarVariables = {
  entityType: ShareEntityType;
  entityId: string;
  title?: string;
  icon?: string | null;
  ownerId?: string | null;
  isStarred: boolean;
};

export function useToggleStar() {
  const queryClient = useQueryClient();
  const identityLifecycle = useIdentityLifecycle();

  return useMutation({
    mutationFn: async ({ entityType, entityId, isStarred }: ToggleStarVariables) => {
      if (!identityLifecycle.isActive()) {
        throw new Error('Identity retired before star update');
      }
      if (isStarred) {
        await removeStar(entityType, entityId);
      } else {
        await addStar(entityType, entityId);
      }
    },
    onMutate: async ({
      entityType,
      entityId,
      title,
      icon,
      ownerId,
      isStarred,
    }: ToggleStarVariables) => {
      await queryClient.cancelQueries({ queryKey: ['stars'] });
      if (!identityLifecycle.isActive()) {
        throw new Error('Identity retired during star update');
      }
      const previousStars = queryClient.getQueryData<StarredEntity[]>(['stars']);
      const key = `${entityType}:${entityId}`;
      queryClient.setQueryData<StarredEntity[]>(['stars'], (old) => {
        const current = old ?? [];
        if (isStarred) {
          return current.filter((star) => `${star.entityType}:${star.entityId}` !== key);
        }
        if (current.some((star) => `${star.entityType}:${star.entityId}` === key)) {
          return current;
        }
        return [
          {
            entityType,
            entityId,
            title: title ?? 'Untitled',
            icon: icon ?? null,
            ownerId: ownerId ?? null,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ];
      });

      return { previousStars };
    },
    onError: (_error, _variables, context) => {
      if (context) {
        queryClient.setQueryData(['stars'], context.previousStars ?? []);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['stars'] });
    },
    meta: { errorMessage: 'Failed to update star' },
  });
}
