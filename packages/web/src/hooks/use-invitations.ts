import type { InvitationClaim, PendingInvitation } from '@metakip/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../utils/api';
import { showSuccessToast } from '../utils/toast';

function invalidateInvitationSurfaces(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['workspace-members'] });
  queryClient.invalidateQueries({ queryKey: ['shares'] });
}

const invitationClaimKey = (token: string | undefined) => ['invitation-claim', token] as const;

export function useInvitationClaim(token: string | undefined, enabled = true) {
  return useQuery({
    queryKey: invitationClaimKey(token),
    queryFn: ({ signal }) => {
      if (!token) throw new Error('Invitation not found');
      return apiFetch<InvitationClaim>(`/invitations/claim/${encodeURIComponent(token)}`, {
        signal,
      });
    },
    enabled: enabled && Boolean(token),
    retry: false,
  });
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<{ destination: string }>(`/invitations/claim/${encodeURIComponent(token)}`, {
        method: 'POST',
      }),
  });
}

export function useDeclineInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<{ ok: true }>(`/invitations/claim/${encodeURIComponent(token)}/decline`, {
        method: 'POST',
      }),
    onSuccess: (_data, token) => {
      queryClient.setQueryData<InvitationClaim>(invitationClaimKey(token), (claim) =>
        claim ? { ...claim, status: 'declined' } : claim,
      );
    },
  });
}

export function useResendInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      apiFetch<{ invitation: PendingInvitation; message?: string }>(
        `/invitations/${invitationId}/resend`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      invalidateInvitationSurfaces(queryClient);
      if (data.message) showSuccessToast(data.message);
    },
    meta: { errorMessage: 'Failed to resend invitation' },
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      apiFetch<{ message?: string }>(`/invitations/${invitationId}`, { method: 'DELETE' }),
    onSuccess: (data) => {
      invalidateInvitationSurfaces(queryClient);
      if (data.message) showSuccessToast(data.message);
    },
    meta: { errorMessage: 'Failed to revoke invitation' },
  });
}
