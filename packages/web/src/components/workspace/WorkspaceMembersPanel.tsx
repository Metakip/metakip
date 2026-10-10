import { Mail, UserRound } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import {
  useChangeMemberRole,
  useInviteToWorkspace,
  useRemoveWorkspaceMember,
  useWorkspaceMembers,
} from '../../hooks/use-workspace';
import { useAuth } from '../../hooks/useAuth';
import { getInitial } from '../../utils/avatar';
import { PendingInvitationRow } from '../PendingInvitationRow';
import { Dropdown, TextBox } from '../ui/FormControls';

const ROLE_LABELS = { viewer: 'Viewer', editor: 'Editor', admin: 'Admin' } as const;

export function WorkspaceMembersPanel() {
  const { data: session } = useAuth();
  const currentUserId = session?.user?.id;
  const { data: membersResponse, isLoading, error, refetch } = useWorkspaceMembers();
  const inviteMutation = useInviteToWorkspace();
  const changeRoleMutation = useChangeMemberRole();
  const removeMemberMutation = useRemoveWorkspaceMember();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor' | 'admin'>('editor');

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    inviteMutation.mutate({ email: trimmed, role: inviteRole }, { onSuccess: () => setEmail('') });
  };

  if (isLoading) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading members...</p>;
  }

  if (error && !membersResponse) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/20"
      >
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          Workspace members couldn&apos;t be loaded.
        </p>
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          No membership changes have been made.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const memberList = membersResponse?.members ?? [];
  const pendingInvitations = membersResponse?.pendingInvitations ?? [];

  return (
    <div className="space-y-4">
      <form onSubmit={handleInvite} className="space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <Mail size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Invite access</p>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950/40">
          <div className="grid gap-0 sm:grid-cols-[minmax(0,1fr)_5rem_auto] sm:items-center">
            <TextBox
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="Enter email"
              className="h-6"
              inputClassName="h-6 py-0 text-sm"
              data-testid="workspace-email-input"
            />
            <Dropdown
              value={inviteRole}
              onChange={setInviteRole}
              ariaLabel="Role for new workspace member"
              options={[
                { value: 'viewer', label: 'Viewer' },
                { value: 'editor', label: 'Editor' },
                { value: 'admin', label: 'Admin' },
              ]}
              className="w-fit"
              triggerClassName="px-2"
            />
            <button
              type="submit"
              disabled={inviteMutation.isPending || !email.trim()}
              data-testid="workspace-invite-btn"
              className="inline-flex h-6 items-center justify-center rounded-lg border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:border-zinc-300 disabled:cursor-default disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:hover:border-zinc-700 cursor-pointer"
            >
              Invite
            </button>
          </div>
        </div>
      </form>

      <div className="space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <UserRound size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Workspace members
            </p>
          </div>
        </div>

        {memberList.length === 0 && pendingInvitations.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No members yet. Invite someone above.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="grid grid-cols-[minmax(0,1.2fr)_0.5fr_0.7fr] gap-2 border-b border-zinc-200 px-3 py-2 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <span>Name</span>
              <span>Role</span>
              <span />
            </div>
            {memberList.map((member) => {
              const isCurrentUser = member.memberId === currentUserId;
              const displayName = isCurrentUser ? 'You' : (member.memberName ?? member.memberEmail);
              const canRemove = !isCurrentUser;

              return (
                <div
                  key={member.id}
                  className="grid grid-cols-[minmax(0,1.2fr)_0.5fr_0.7fr] items-center gap-2 border-b border-zinc-200 px-3 py-1.5 last:border-b-0 dark:border-zinc-800"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full overflow-hidden"
                      style={{
                        backgroundColor: member.memberAvatarUrl ? undefined : '#71717a',
                      }}
                    >
                      {member.memberAvatarUrl ? (
                        <img
                          src={member.memberAvatarUrl}
                          alt={member.memberName ?? 'User'}
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="text-[9px] font-bold text-white">
                          {getInitial(displayName)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate max-w-[18ch]">
                      {displayName}
                    </p>
                  </div>
                  {isCurrentUser ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {ROLE_LABELS[member.role]}
                    </span>
                  ) : (
                    <Dropdown
                      value={member.role}
                      options={[
                        { value: 'viewer', label: 'Viewer' },
                        { value: 'editor', label: 'Editor' },
                        { value: 'admin', label: 'Admin' },
                        { value: 'remove', label: 'Remove' },
                      ]}
                      ariaLabel={`Role for ${displayName}`}
                      onChange={(role) => {
                        if (role === 'remove') {
                          if (canRemove) {
                            removeMemberMutation.mutate(member.memberId);
                          }
                        } else {
                          changeRoleMutation.mutate({
                            memberId: member.memberId,
                            role: role as 'viewer' | 'editor' | 'admin',
                          });
                        }
                      }}
                      className="w-fit"
                      triggerClassName="px-1.5 text-xs"
                    />
                  )}
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                    {member.memberEmail}
                  </span>
                </div>
              );
            })}
            {pendingInvitations.map((invitation) => (
              <PendingInvitationRow
                key={invitation.id}
                invitation={invitation}
                permissionLabel={ROLE_LABELS[invitation.permission]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
