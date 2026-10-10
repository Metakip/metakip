import type { InvitationClaim } from '@metakip/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  navigate: vi.fn(),
  signOut: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('../utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/api')>()),
  apiFetch: mocks.apiFetch,
}));
vi.mock('../lib/auth-client', () => ({ authClient: { signOut: mocks.signOut } }));
vi.mock('./useAuth', () => ({ useAuth: mocks.useAuth }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}));

import { ApiError } from '../utils/api';
import { useInvitationController } from './useInvitationController';

const claim: InvitationClaim = {
  status: 'pending',
  targetType: 'page',
  targetTitle: 'Shared page',
  inviterName: 'Inviter',
  email: 'invitee@example.com',
  permission: 'view',
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/invite/invitation-token']}>
        <Routes>
          <Route path="/invite/:token" element={<div>{children}</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('useInvitationController', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.navigate.mockReset();
    mocks.signOut.mockReset();
    mocks.useAuth.mockReturnValue({ data: null, isPending: false });
    sessionStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  it('moves through explicit decision and terminal phases when declining', async () => {
    mocks.apiFetch.mockResolvedValueOnce(claim).mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useInvitationController(), { wrapper });

    await waitFor(() => expect(result.current.phase.kind).toBe('awaiting-decision'));
    await act(() => result.current.decline());

    expect(result.current.phase).toMatchObject({
      kind: 'terminal',
      claim: { status: 'declined' },
    });
    expect(queryClient.getQueryData(['invitation-claim', 'invitation-token'])).toMatchObject({
      status: 'declined',
    });
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(
      2,
      '/invitations/claim/invitation-token/decline',
      { method: 'POST' },
    );
  });

  it('does not accept while a decline decision is pending', async () => {
    mocks.useAuth.mockReturnValue({ data: { user: { id: 'invitee' } }, isPending: false });
    let finishDecline: ((result: { ok: true }) => void) | undefined;
    const pendingDecline = new Promise<{ ok: true }>((resolve) => {
      finishDecline = resolve;
    });
    mocks.apiFetch.mockResolvedValueOnce(claim).mockReturnValueOnce(pendingDecline);
    const { result } = renderHook(() => useInvitationController(), { wrapper });

    await waitFor(() => expect(result.current.phase.kind).toBe('awaiting-decision'));
    act(() => {
      void result.current.decline();
    });
    await waitFor(() => expect(result.current.phase.kind).toBe('declining'));
    act(() => void result.current.accept());

    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
    await act(async () => finishDecline?.({ ok: true }));
  });

  it('allows a failed invitation decision to be retried', async () => {
    mocks.useAuth.mockReturnValue({ data: { user: { id: 'invitee' } }, isPending: false });
    const pendingRetry = new Promise<{ destination: string }>(() => undefined);
    mocks.apiFetch
      .mockResolvedValueOnce(claim)
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockReturnValueOnce(pendingRetry);
    const { result } = renderHook(() => useInvitationController(), { wrapper });

    await waitFor(() => expect(result.current.phase.kind).toBe('awaiting-decision'));
    await act(async () => result.current.accept());
    expect(result.current.phase).toMatchObject({
      kind: 'decision-error',
      attemptedAction: 'accept',
      message: 'Temporary network failure',
    });

    act(() => void result.current.accept());
    await waitFor(() => expect(result.current.phase.kind).toBe('accepting'));
    expect(mocks.apiFetch).toHaveBeenCalledTimes(3);
  });

  it('resumes an explicit acceptance automatically after sign-in', async () => {
    mocks.useAuth.mockReturnValue({ data: { user: { id: 'invitee' } }, isPending: false });
    const pendingAcceptance = new Promise<{ destination: string }>(() => undefined);
    sessionStorage.setItem(
      'metakip:pending-invitation-accept',
      JSON.stringify({ token: 'invitation-token', expiresAt: Date.now() + 60_000 }),
    );
    mocks.apiFetch.mockResolvedValueOnce(claim).mockReturnValueOnce(pendingAcceptance);
    const { result } = renderHook(() => useInvitationController(), { wrapper });

    await waitFor(() => expect(result.current.phase.kind).toBe('accepting'));

    expect(sessionStorage.getItem('metakip:pending-invitation-accept')).toBeNull();
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(2, '/invitations/claim/invitation-token', {
      method: 'POST',
    });
  });

  it('refreshes terminal invitation failures instead of offering a retry', async () => {
    mocks.useAuth.mockReturnValue({ data: { user: { id: 'invitee' } }, isPending: false });
    mocks.apiFetch
      .mockResolvedValueOnce(claim)
      .mockRejectedValueOnce(new ApiError(410, 'Invitation was revoked'))
      .mockResolvedValueOnce({ ...claim, status: 'revoked' });
    const { result } = renderHook(() => useInvitationController(), { wrapper });

    await waitFor(() => expect(result.current.phase.kind).toBe('awaiting-decision'));
    await act(async () => result.current.accept());

    expect(result.current.phase).toMatchObject({
      kind: 'terminal',
      claim: { status: 'revoked' },
    });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    'accept',
    'decline',
  ] as const)('uses refreshed revoked claims after a temporary %s failure', async (action) => {
    mocks.useAuth.mockReturnValue({ data: { user: { id: 'invitee' } }, isPending: false });
    mocks.apiFetch
      .mockResolvedValueOnce(claim)
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValueOnce({ ...claim, status: 'revoked' });
    const { result } = renderHook(() => useInvitationController(), { wrapper });
    await waitFor(() => expect(result.current.phase.kind).toBe('awaiting-decision'));
    await act(() => result.current[action]());
    expect(result.current.phase.kind).toBe('decision-error');

    await act(() =>
      queryClient.refetchQueries({ queryKey: ['invitation-claim', 'invitation-token'] }),
    );
    await waitFor(() =>
      expect(result.current.phase).toMatchObject({
        kind: 'terminal',
        claim: { status: 'revoked' },
      }),
    );
    await act(() => result.current.accept());
    expect(mocks.apiFetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    'accepted',
    'superseded',
  ] as const)('replaces a stale decision error when refreshed access is %s', async (status) => {
    mocks.useAuth.mockReturnValue({ data: { user: { id: 'invitee' } }, isPending: false });
    mocks.apiFetch
      .mockResolvedValueOnce(claim)
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValueOnce({ ...claim, status });
    const { result } = renderHook(() => useInvitationController(), { wrapper });
    await waitFor(() => expect(result.current.phase.kind).toBe('awaiting-decision'));
    await act(() => result.current.accept());
    await act(() =>
      queryClient.refetchQueries({ queryKey: ['invitation-claim', 'invitation-token'] }),
    );
    await waitFor(() =>
      expect(result.current.phase).toMatchObject({ kind: 'terminal', claim: { status } }),
    );
  });

  it('uses refreshed invitation details while retaining a recoverable action error', async () => {
    mocks.useAuth.mockReturnValue({ data: { user: { id: 'invitee' } }, isPending: false });
    mocks.apiFetch
      .mockResolvedValueOnce(claim)
      .mockRejectedValueOnce(new Error('Temporary network failure'))
      .mockResolvedValueOnce({ ...claim, targetTitle: 'Renamed page', permission: 'edit' });
    const { result } = renderHook(() => useInvitationController(), { wrapper });
    await waitFor(() => expect(result.current.phase.kind).toBe('awaiting-decision'));
    await act(() => result.current.accept());
    await act(() =>
      queryClient.refetchQueries({ queryKey: ['invitation-claim', 'invitation-token'] }),
    );
    await waitFor(() =>
      expect(result.current.phase).toMatchObject({
        kind: 'decision-error',
        claim: { targetTitle: 'Renamed page', permission: 'edit' },
      }),
    );
  });

  it('requires explicit acceptance before offering to switch accounts', async () => {
    mocks.useAuth.mockReturnValue({ data: { user: { id: 'other-user' } }, isPending: false });
    mocks.apiFetch.mockResolvedValueOnce(claim).mockRejectedValueOnce(
      new ApiError(403, 'Use the invited account', {
        code: 'INVITATION_EMAIL_MISMATCH',
      }),
    );
    mocks.signOut.mockRejectedValueOnce(new Error('Provider unavailable'));
    const { result } = renderHook(() => useInvitationController(), { wrapper });

    await waitFor(() => expect(result.current.phase.kind).toBe('awaiting-decision'));
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    await act(async () => result.current.accept());
    await waitFor(() => expect(result.current.phase.kind).toBe('email-mismatch'));
    expect(mocks.signOut).not.toHaveBeenCalled();

    await act(() => result.current.switchAccount());

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(result.current.phase).toMatchObject({
      kind: 'email-mismatch',
      claim: { email: claim.email },
      message: 'Could not sign out of the current account',
    });
  });

  it('returns directly to login and resumes acceptance after switching accounts', async () => {
    mocks.useAuth.mockReturnValue({ data: { user: { id: 'other-user' } }, isPending: false });
    mocks.apiFetch
      .mockResolvedValueOnce(claim)
      .mockRejectedValueOnce(
        new ApiError(403, 'Use the invited account', { code: 'INVITATION_EMAIL_MISMATCH' }),
      );
    const { result } = renderHook(() => useInvitationController(), { wrapper });

    await waitFor(() => expect(result.current.phase.kind).toBe('awaiting-decision'));
    await act(() => result.current.accept());
    await act(() => result.current.switchAccount());

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(
      JSON.parse(sessionStorage.getItem('metakip:pending-invitation-accept') ?? '{}'),
    ).toMatchObject({
      token: 'invitation-token',
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/login',
      expect.objectContaining({
        state: expect.objectContaining({
          from: expect.objectContaining({ pathname: '/invite/invitation-token' }),
          invitationEmail: claim.email,
        }),
      }),
    );
  });
});
