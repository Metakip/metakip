import type { WorkspaceRole } from './access.js';
import type { PendingWorkspaceInvitation } from './sharing.js';

export type { WorkspaceRole } from './access.js';

export interface WorkspaceMembership {
  ownerId: string;
  ownerName: string | null;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceOwnerId: string;
  memberId: string;
  memberName: string | null;
  memberEmail: string;
  memberAvatarUrl: string | null;
  role: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceMembersResponse {
  members: WorkspaceMember[];
  pendingInvitations: PendingWorkspaceInvitation[];
}
