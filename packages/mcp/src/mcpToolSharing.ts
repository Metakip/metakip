import {
  v1CreateShareGrantRequestSchema,
  v1ResentShareInvitationSchema,
  v1ShareEntityTypeSchema,
  v1ShareGrantResponseSchema,
  v1ShareInheritanceSchema,
  v1ShareMutationSchema,
  v1SharePublicAccessSchema,
  v1SharingSummarySchema,
  v1UpdateInheritanceRequestSchema,
  v1UpdatePublicAccessRequestSchema,
  v1UpdateShareGrantRequestSchema,
  v1WorkspaceMemberAddedSchema,
  v1WorkspaceRoleSchema,
  v1WorkspaceSharingSummarySchema,
} from '@metakip/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  destructiveAnnotations,
  readAnnotations,
  registerTool,
  writeAnnotations,
} from './mcpToolRegistration';
import type { McpRequestBackend } from './types';

const entityReferenceShape = {
  entityType: v1ShareEntityTypeSchema,
  reference: z.string().trim().min(1),
};

const invitationWriteAnnotations = { ...writeAnnotations, openWorldHint: true } as const;

export function registerSharingTools(
  server: McpServer,
  backend: McpRequestBackend,
  canWrite: boolean,
): void {
  registerTool(
    server,
    'get_sharing_settings',
    'Use this to inspect effective access and sharing settings for an accessible Metakip page or folder. Non-admin users receive a privacy-limited summary.',
    entityReferenceShape,
    readAnnotations,
    v1SharingSummarySchema,
    (input, options) => backend.getSharingSummary(input.entityType, input.reference, options),
  );

  registerTool(
    server,
    'get_workspace_sharing_settings',
    'Use this to inspect the current user’s workspace members, joined workspaces, and pending workspace invitations. The ownerId in memberships identifies a workspace you joined and is used to leave it.',
    {},
    readAnnotations,
    v1WorkspaceSharingSummarySchema,
    (_input, options) => backend.getWorkspaceSharingSummary(options),
  );

  if (!canWrite) return;

  registerTool(
    server,
    'share_entity',
    'Use this when asked to grant a person access to a page or folder. Existing accounts receive access immediately; unknown email addresses receive an invitation. Only the owner can grant Admin access.',
    {
      ...entityReferenceShape,
      email: v1CreateShareGrantRequestSchema.shape.email,
      permission: v1CreateShareGrantRequestSchema.shape.permission,
    },
    invitationWriteAnnotations,
    v1ShareGrantResponseSchema,
    (input, options) =>
      backend.grantEntityAccess(
        input.entityType,
        input.reference,
        { email: input.email, permission: input.permission },
        options,
      ),
  );

  registerTool(
    server,
    'update_share_permission',
    'Use this to change a direct page or folder share. Identify the recipient by email and the target by its reference. Only the owner can grant or change Admin access.',
    {
      ...entityReferenceShape,
      email: v1CreateShareGrantRequestSchema.shape.email,
      permission: v1UpdateShareGrantRequestSchema.shape.permission,
    },
    writeAnnotations,
    v1ShareMutationSchema,
    (input, options) =>
      backend.updateSharePermission(
        input.entityType,
        input.reference,
        input.email,
        input.permission,
        options,
      ),
  );

  registerTool(
    server,
    'remove_share',
    'Use this to remove a person’s direct page or folder share. Identify the recipient by email and the target by its reference. To remove an item from your own view, use leave_shared_entity instead.',
    { ...entityReferenceShape, email: v1CreateShareGrantRequestSchema.shape.email },
    destructiveAnnotations,
    v1ShareMutationSchema,
    (input, options) =>
      backend.revokeShare(input.entityType, input.reference, input.email, options),
  );

  registerTool(
    server,
    'leave_shared_entity',
    'Use this when asked to remove a page or folder shared with the current user from their view. This removes their own direct share or saved public access, not inherited access or anyone else’s access.',
    entityReferenceShape,
    destructiveAnnotations,
    v1ShareMutationSchema,
    (input, options) => backend.leaveSharedEntity(input.entityType, input.reference, options),
  );

  registerTool(
    server,
    'set_public_access',
    'Use this to make a page or folder private, publicly viewable, or publicly editable. Public access allows anyone with the URL to access the content; only use it when explicitly requested.',
    { ...entityReferenceShape, permission: v1UpdatePublicAccessRequestSchema.shape.permission },
    writeAnnotations,
    v1SharePublicAccessSchema,
    (input, options) =>
      backend.updatePublicAccess(input.entityType, input.reference, input.permission, options),
  );

  registerTool(
    server,
    'set_sharing_inheritance',
    'Use this to change whether a page or folder inherits access from its parent folders and workspace. Restricted access stops inherited permissions; direct grants remain.',
    { ...entityReferenceShape, policy: v1UpdateInheritanceRequestSchema.shape.policy },
    writeAnnotations,
    v1ShareInheritanceSchema,
    (input, options) =>
      backend.updateSharingInheritance(input.entityType, input.reference, input.policy, options),
  );

  registerTool(
    server,
    'resend_share_invitation',
    'Use this to resend a pending page or folder sharing invitation. Identify the invitation by recipient email and target reference.',
    { ...entityReferenceShape, email: v1CreateShareGrantRequestSchema.shape.email },
    invitationWriteAnnotations,
    v1ResentShareInvitationSchema,
    (input, options) =>
      backend.resendSharingInvitation(input.entityType, input.reference, input.email, options),
  );

  registerTool(
    server,
    'cancel_share_invitation',
    'Use this to cancel a pending page or folder sharing invitation. Identify the invitation by recipient email and target reference.',
    { ...entityReferenceShape, email: v1CreateShareGrantRequestSchema.shape.email },
    destructiveAnnotations,
    v1ShareMutationSchema,
    (input, options) =>
      backend.cancelSharingInvitation(input.entityType, input.reference, input.email, options),
  );

  registerTool(
    server,
    'add_workspace_member',
    'Use this to add a person to the current user’s workspace by email. Existing accounts join immediately; unknown email addresses receive an invitation.',
    { email: v1CreateShareGrantRequestSchema.shape.email, role: v1WorkspaceRoleSchema },
    invitationWriteAnnotations,
    v1WorkspaceMemberAddedSchema,
    (input, options) => backend.addWorkspaceMember(input.email, input.role, options),
  );

  registerTool(
    server,
    'update_workspace_member',
    'Use this to change a workspace member’s role. Identify the member by email.',
    { email: v1CreateShareGrantRequestSchema.shape.email, role: v1WorkspaceRoleSchema },
    writeAnnotations,
    v1ShareMutationSchema,
    (input, options) => backend.updateWorkspaceMember(input.email, input.role, options),
  );

  registerTool(
    server,
    'remove_workspace_member',
    'Use this to remove a person from your workspace. Identify the member by email.',
    { email: v1CreateShareGrantRequestSchema.shape.email },
    destructiveAnnotations,
    v1ShareMutationSchema,
    (input, options) => backend.removeWorkspaceMember(input.email, options),
  );

  registerTool(
    server,
    'leave_workspace',
    'Use this to leave a workspace you joined. First inspect get_workspace_sharing_settings and use the matching ownerId from memberships. Workspace owners cannot leave their own workspace.',
    { ownerId: z.string().uuid() },
    destructiveAnnotations,
    v1ShareMutationSchema,
    (input, options) => backend.leaveWorkspace(input.ownerId, options),
  );

  registerTool(
    server,
    'resend_workspace_invitation',
    'Use this to resend a pending invitation to join your workspace. Identify the invitee by email.',
    { email: v1CreateShareGrantRequestSchema.shape.email },
    invitationWriteAnnotations,
    v1ResentShareInvitationSchema,
    (input, options) => backend.resendWorkspaceInvitation(input.email, options),
  );

  registerTool(
    server,
    'cancel_workspace_invitation',
    'Use this to cancel a pending invitation to join your workspace. Identify the invitee by email.',
    { email: v1CreateShareGrantRequestSchema.shape.email },
    destructiveAnnotations,
    v1ShareMutationSchema,
    (input, options) => backend.cancelWorkspaceInvitation(input.email, options),
  );
}
