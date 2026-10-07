import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../utils/api';

export type ApiToken = {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type CreatedApiToken = ApiToken & { token: string };

const tokenQueryKey = ['apiTokens'] as const;

function apiTokenMetadata(created: CreatedApiToken): ApiToken {
  return {
    id: created.id,
    name: created.name,
    scopes: created.scopes,
    expiresAt: created.expiresAt,
    lastUsedAt: created.lastUsedAt,
    createdAt: created.createdAt,
  };
}

export function useApiTokens() {
  return useQuery({
    queryKey: tokenQueryKey,
    queryFn: () => apiFetch<{ data: ApiToken[] }>('/v1/tokens'),
    select: (response) => response.data,
  });
}

export function useCreateApiToken(onCreatedSecret: (secret: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: {
      name: string;
      access: 'read' | 'comment' | 'write';
      expiresAt: string | null;
    }) => {
      const scopes = [`pages:${request.access}`];
      const created = await apiFetch<CreatedApiToken>('/v1/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: request.name,
          scopes,
          expiresAt: request.expiresAt,
        }),
      });
      onCreatedSecret(created.token);
      return apiTokenMetadata(created);
    },
    onSuccess: (created) => {
      queryClient.setQueryData<{ data: ApiToken[] }>(tokenQueryKey, (current) => ({
        data: [created, ...(current?.data ?? [])],
      }));
    },
  });
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => apiFetch<void>(`/v1/tokens/${tokenId}`, { method: 'DELETE' }),
    onSuccess: (_result, tokenId) => {
      queryClient.setQueryData<{ data: ApiToken[] }>(tokenQueryKey, (current) => ({
        data: (current?.data ?? []).filter((token) => token.id !== tokenId),
      }));
    },
  });
}
