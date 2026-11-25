import type { WorkspaceRole } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { UserRound } from 'lucide-react';
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
import { AccessLoadError, AccessSectionHeading, InviteAccessForm } from '../access/AccessControls';
import { styles as accessStyles } from '../access/AccessControls.stylex';
import { AccessTable, AccessTableRow } from '../access/AccessTable';
import { PendingInvitationRow } from '../PendingInvitationRow';
import { Dropdown, TextBox } from '../ui/FormControls';
import { styles } from './WorkspaceMembersPanel.stylex';

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  viewer: 'Viewer',
  commenter: 'Commenter',
  editor: 'Editor',
  admin: 'Admin',
};

export function WorkspaceMembersPanel() {
  const { data: session } = useAuth();
  const currentUserId = session?.user?.id;
  const { data: membersResponse, isLoading, error, refetch } = useWorkspaceMembers();
  const inviteMutation = useInviteToWorkspace();
  const changeRoleMutation = useChangeMemberRole();
  const removeMemberMutation = useRemoveWorkspaceMember();

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('editor');

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    inviteMutation.mutate({ email: trimmed, role: inviteRole }, { onSuccess: () => setEmail('') });
  };

  if (isLoading) {
    return <p {...stylex.props(styles.loading)}>Loading members...</p>;
  }

  if (error && !membersResponse) {
    return (
      <AccessLoadError
        title="Workspace members couldn't be loaded."
        description="No membership changes have been made."
        onRetry={() => void refetch()}
      />
    );
  }

  const memberList = membersResponse?.members ?? [];
  const pendingInvitations = membersResponse?.pendingInvitations ?? [];

  return (
    <div {...stylex.props(styles.panel)}>
      <InviteAccessForm title="Invite Access" onSubmit={handleInvite}>
        <TextBox
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="Enter email"
          rootStyle={accessStyles.emailField}
          inputStyle={accessStyles.emailInput}
          data-testid="workspace-email-input"
        />
        <Dropdown
          value={inviteRole}
          onChange={setInviteRole}
          ariaLabel="Role for new workspace member"
          options={[
            { value: 'viewer', label: 'Viewer' },
            { value: 'commenter', label: 'Commenter' },
            { value: 'editor', label: 'Editor' },
            { value: 'admin', label: 'Admin' },
          ]}
          rootStyle={accessStyles.permissionDropdown}
          triggerStyle={accessStyles.permissionTrigger}
        />
        <button
          type="submit"
          disabled={inviteMutation.isPending || !email.trim()}
          data-testid="workspace-invite-btn"
          {...stylex.props(accessStyles.submitButton)}
        >
          Invite
        </button>
      </InviteAccessForm>

      <div {...stylex.props(styles.membersSection)}>
        <AccessSectionHeading icon={<UserRound size={16} />} title="Workspace Members" />

        {memberList.length === 0 && pendingInvitations.length === 0 ? (
          <p {...stylex.props(styles.emptyState)}>No members yet. Invite someone above.</p>
        ) : (
          <AccessTable headers={['Name', 'Role', '']}>
            {memberList.map((member) => {
              const isCurrentUser = member.memberId === currentUserId;
              const displayName = isCurrentUser ? 'You' : (member.memberName ?? member.memberEmail);
              const canRemove = !isCurrentUser;

              return (
                <AccessTableRow key={member.id}>
                  <div {...stylex.props(styles.memberIdentity)}>
                    <div
                      {...stylex.props(styles.avatar)}
                      style={{
                        backgroundColor: member.memberAvatarUrl ? undefined : '#71717a',
                      }}
                    >
                      {member.memberAvatarUrl ? (
                        <img
                          src={member.memberAvatarUrl}
                          alt={member.memberName ?? 'User'}
                          {...stylex.props(styles.avatarImage)}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span {...stylex.props(styles.avatarInitial)}>
                          {getInitial(displayName)}
                        </span>
                      )}
                    </div>
                    <p {...stylex.props(styles.memberName)}>{displayName}</p>
                  </div>
                  {isCurrentUser ? (
                    <span {...stylex.props(styles.memberRole)}>{ROLE_LABELS[member.role]}</span>
                  ) : (
                    <Dropdown
                      value={member.role}
                      options={[
                        { value: 'viewer', label: 'Viewer' },
                        { value: 'commenter', label: 'Commenter' },
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
                            role,
                          });
                        }
                      }}
                      rootStyle={accessStyles.permissionDropdown}
                      triggerStyle={accessStyles.compactPermissionTrigger}
                    />
                  )}
                  <span {...stylex.props(styles.memberEmail)}>{member.memberEmail}</span>
                </AccessTableRow>
              );
            })}
            {pendingInvitations.map((invitation) => (
              <PendingInvitationRow
                key={invitation.id}
                invitation={invitation}
                permissionLabel={ROLE_LABELS[invitation.permission]}
              />
            ))}
          </AccessTable>
        )}
      </div>
    </div>
  );
}
