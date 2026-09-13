import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../utils/api';
import { useCreateApiToken } from './useApiTokens';

vi.mock('../utils/api', () => ({ apiFetch: vi.fn() }));

describe('useCreateApiToken', () => {
  it('does not retain the one-time secret in the token list cache', async () => {
    const created = {
      id: 'token-id',
      name: 'Agent',
      scopes: ['pages:read'],
      expiresAt: null,
      lastUsedAt: null,
      createdAt: '2026-07-26T00:00:00.000Z',
      token: 'metakip_one_time_secret',
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(created);
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    let createdSecret: string | null = null;
    const { result } = renderHook(() => useCreateApiToken((secret) => (createdSecret = secret)), {
      wrapper,
    });

    let mutationResult: unknown;
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        name: 'Agent',
        canWrite: false,
        expiresAt: null,
      });
    });

    const cached = queryClient.getQueryData<{ data: Array<Record<string, unknown>> }>([
      'apiTokens',
    ]);
    expect(cached?.data).toEqual([
      {
        id: created.id,
        name: created.name,
        scopes: created.scopes,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: created.createdAt,
      },
    ]);
    expect(JSON.stringify(cached)).not.toContain(created.token);
    expect(createdSecret).toBe(created.token);
    expect(mutationResult).not.toHaveProperty('token');
  });
});
