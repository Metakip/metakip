import type { WorkspaceMembership, WorkspaceMembersResponse } from '@metakip/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../utils/api';
import { isBulkRemovalInProgress } from '../utils/bulkRemovalState';
import { showSuccessToast } from '../utils/toast';

export type { WorkspaceMember, WorkspaceMembership } from '@metakip/shared';

async function fetchWorkspaceMembers(): Promise<WorkspaceMembersResponse> {
  return apiFetch<WorkspaceMembersResponse>('/workspace/members');
}

export function useWorkspaceMembers() {
  return useQuery({
    queryKey: ['workspace-members'],
    queryFn: fetchWorkspaceMembers,
    staleTime: 1000 * 60,
    refetchOnWindowFocus: () => (isBulkRemovalInProgress() ? false : 'always'),
    refetchOnReconnect: () => (isBulkRemovalInProgress() ? false : 'always'),
    refetchInterval: () => (isBulkRemovalInProgress() ? false : 30_000),
    refetchIntervalInBackground: true,
  });
}

async function fetchWorkspaceMemberships(): Promise<WorkspaceMembership[]> {
  return apiFetch<WorkspaceMembership[]>('/workspace/memberships');
}

export function useWorkspaceMemberships({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['workspace-memberships'],
    queryFn: fetchWorkspaceMemberships,
    enabled,
    staleTime: 1000 * 60,
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

export const WORKSPACE_ACCESS_QUERY_KEYS = [
  ['workspace-members'],
  ['workspace-memberships'],
  ['shared-with-me'],
  ['pageTree'],
  ['folderTree'],
  ['pages', 'recent'],
  ['favorites'],
  ['tags'],
  ['shares'],
  ['pageCollaborators'],
  ['folderCollaborators'],
  ['pages', 'detail'],
  ['folders', 'detail'],
] as const;

export function invalidateWorkspaceAccessQueries(queryClient: QueryClient): void {
  for (const queryKey of WORKSPACE_ACCESS_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey });
  }
}

async function inviteToWorkspace({
  email,
  role,
}: {
  email: string;
  role: 'viewer' | 'editor' | 'admin';
}): Promise<{ message?: string }> {
  return apiFetch<{ message?: string }>('/workspace/members/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
}

export function useInviteToWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: inviteToWorkspace,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pageCollaborators'] });
      queryClient.invalidateQueries({ queryKey: ['folderCollaborators'] });
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      if (data?.message) showSuccessToast(data.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members'] });
    },
    meta: { errorMessage: 'Failed to invite' },
  });
}

async function changeMemberRole({
  memberId,
  role,
}: {
  memberId: string;
  role: 'viewer' | 'editor' | 'admin';
}): Promise<{ message?: string }> {
  return apiFetch<{ message?: string }>(`/workspace/members/${memberId}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

export function useChangeMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: changeMemberRole,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members'] });
      queryClient.invalidateQueries({ queryKey: ['pageCollaborators'] });
      queryClient.invalidateQueries({ queryKey: ['folderCollaborators'] });
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      if (data?.message) showSuccessToast(data.message);
    },
    meta: { errorMessage: 'Failed to change role' },
  });
}

async function removeWorkspaceMember(memberId: string): Promise<{ message?: string }> {
  return apiFetch<{ message?: string }>(`/workspace/members/${memberId}`, {
    method: 'DELETE',
  });
}

export function useRemoveWorkspaceMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeWorkspaceMember,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members'] });
      queryClient.invalidateQueries({ queryKey: ['pageCollaborators'] });
      queryClient.invalidateQueries({ queryKey: ['folderCollaborators'] });
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      if (data?.message) showSuccessToast(data.message);
    },
    meta: { errorMessage: 'Failed to remove member' },
  });
}

async function leaveWorkspace({
  ownerId,
  memberId,
}: {
  ownerId: string;
  memberId: string;
}): Promise<{ message?: string }> {
  return apiFetch<{ message?: string }>(
    `/workspace/members/${memberId}?workspaceOwnerId=${encodeURIComponent(ownerId)}`,
    { method: 'DELETE' },
  );
}

export function useLeaveWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: leaveWorkspace,
    onSuccess: (data) => {
      invalidateWorkspaceAccessQueries(queryClient);
      if (data?.message) showSuccessToast(data.message);
    },
    meta: { errorMessage: 'Failed to leave workspace' },
  });
}
