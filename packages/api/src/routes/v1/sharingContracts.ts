import {
  v1CreateShareGrantRequestSchema,
  v1ResentShareInvitationSchema,
  v1ShareEntityTypeSchema,
  v1ShareInheritanceSchema,
  v1ShareInvitationQueuedSchema,
  v1ShareMutationSchema,
  v1SharePublicAccessSchema,
  v1SharingSummarySchema,
  v1UpdateInheritanceRequestSchema,
  v1UpdatePublicAccessRequestSchema,
  v1UpdateShareGrantRequestSchema,
  v1WorkspaceAddMemberRequestSchema,
  v1WorkspaceMemberAddedSchema,
  v1WorkspaceRoleRequestSchema,
  v1WorkspaceSharingSummarySchema,
} from '@metakip/shared';
import { jsonContent, uuidPathParameter, type V1OperationContract } from './apiContract';

export {
  v1CreateShareGrantRequestSchema as createShareGrantRequestSchema,
  v1UpdateInheritanceRequestSchema as updateInheritanceRequestSchema,
  v1UpdatePublicAccessRequestSchema as updatePublicAccessRequestSchema,
  v1UpdateShareGrantRequestSchema as updateShareGrantRequestSchema,
  v1WorkspaceAddMemberRequestSchema as addWorkspaceMemberRequestSchema,
  v1WorkspaceRoleRequestSchema as workspaceRoleRequestSchema,
};

const entityPathParameters = [
  {
    name: 'entityType',
    in: 'path',
    required: true,
    description: 'The kind of Metakip entity to share.',
    schema: { type: 'string', enum: v1ShareEntityTypeSchema.options },
  },
  uuidPathParameter('entityId'),
] as const;
const sharesTag = ['Sharing'] as const;
const emailPathParameter = {
  name: 'email',
  in: 'path',
  required: true,
  description: 'The recipient email address.',
  schema: { type: 'string', format: 'email' },
} as const;
const entityEmailPathParameters = [...entityPathParameters, emailPathParameter];

export const sharingOperations = {
  summary: {
    method: 'get',
    routePath: '/entity/:entityType/:entityId',
    openApiPath: '/shares/entity/{entityType}/{entityId}',
    summary: 'Get Sharing Settings',
    description:
      'Returns sharing settings for an accessible page or folder. Only owners and administrators receive management details; other viewers receive a privacy-limited summary.',
    tags: sharesTag,
    requiredScopes: ['pages:read'],
    parameters: entityPathParameters,
    responses: {
      '200': {
        description: 'Sharing settings and effective access for the entity.',
        content: jsonContent(v1SharingSummarySchema),
      },
    },
  },
  updateInheritance: {
    method: 'patch',
    routePath: '/entity/:entityType/:entityId/inheritance',
    openApiPath: '/shares/entity/{entityType}/{entityId}/inheritance',
    summary: 'Update Inherited Access',
    description:
      'Controls whether a page or folder inherits access from its parent folders and workspace.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: entityPathParameters,
    request: { required: true, ...jsonContent(v1UpdateInheritanceRequestSchema) },
    responses: {
      '200': {
        description: 'Updated inheritance policy.',
        content: jsonContent(v1ShareInheritanceSchema),
      },
    },
  },
  updatePublicAccess: {
    method: 'patch',
    routePath: '/entity/:entityType/:entityId/public-access',
    openApiPath: '/shares/entity/{entityType}/{entityId}/public-access',
    summary: 'Update Public Access',
    description:
      'Makes a page or folder private, publicly viewable, or publicly editable. Public access can expose content to anyone with its URL.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: entityPathParameters,
    request: { required: true, ...jsonContent(v1UpdatePublicAccessRequestSchema) },
    responses: {
      '200': {
        description: 'Updated public access.',
        content: jsonContent(v1SharePublicAccessSchema),
      },
    },
  },
  createGrant: {
    method: 'post',
    routePath: '/entity/:entityType/:entityId/grants',
    openApiPath: '/shares/entity/{entityType}/{entityId}/grants',
    summary: 'Share A Page Or Folder With Someone',
    description:
      'Grants access to an existing Metakip user or queues an email invitation for a new user. Only an owner or administrator can share an entity; only the owner can grant Admin access.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: entityPathParameters,
    request: { required: true, ...jsonContent(v1CreateShareGrantRequestSchema) },
    responses: {
      '200': {
        description: 'Access granted to an existing user.',
        content: jsonContent(v1ShareMutationSchema),
      },
      '202': {
        description: 'An invitation was queued for an email address without an account.',
        content: jsonContent(v1ShareInvitationQueuedSchema),
      },
    },
  },
  updateGrant: {
    method: 'patch',
    routePath: '/grants/:grantId',
    openApiPath: '/shares/grants/{grantId}',
    summary: 'Update A Share Permission',
    description:
      'Changes the permission on a direct share. Only the owner can grant or modify Admin access.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [uuidPathParameter('grantId')],
    request: { required: true, ...jsonContent(v1UpdateShareGrantRequestSchema) },
    responses: {
      '200': {
        description: 'Share permission updated.',
        content: jsonContent(v1ShareMutationSchema),
      },
    },
  },
  revokeGrant: {
    method: 'delete',
    routePath: '/grants/:grantId',
    openApiPath: '/shares/grants/{grantId}',
    summary: 'Revoke A Share',
    description: 'Removes a direct share. A recipient may also remove their own access.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [uuidPathParameter('grantId')],
    responses: {
      '200': { description: 'Share removed.', content: jsonContent(v1ShareMutationSchema) },
    },
  },
  updateGrantByEmail: {
    method: 'patch',
    routePath: '/entity/:entityType/:entityId/grants/by-email/:email',
    openApiPath: '/shares/entity/{entityType}/{entityId}/grants/by-email/{email}',
    summary: 'Update A Direct Share By Email',
    description:
      'Finds and updates a direct share under the entity access lock. Only the owner can change Admin access.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: entityEmailPathParameters,
    request: { required: true, ...jsonContent(v1UpdateShareGrantRequestSchema) },
    responses: {
      '200': {
        description: 'Share permission updated.',
        content: jsonContent(v1ShareMutationSchema),
      },
    },
  },
  revokeGrantByEmail: {
    method: 'delete',
    routePath: '/entity/:entityType/:entityId/grants/by-email/:email',
    openApiPath: '/shares/entity/{entityType}/{entityId}/grants/by-email/{email}',
    summary: 'Remove A Direct Share By Email',
    description:
      'Finds and removes a direct share under the entity access lock. Only owners and administrators can use this endpoint.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: entityEmailPathParameters,
    responses: {
      '200': { description: 'Share removed.', content: jsonContent(v1ShareMutationSchema) },
    },
  },
  leaveEntity: {
    method: 'post',
    routePath: '/entity/:entityType/:entityId/leave',
    openApiPath: '/shares/entity/{entityType}/{entityId}/leave',
    summary: 'Remove A Shared Entity From Your View',
    description:
      'Removes your own direct share or saved public access. Inherited access from a folder or workspace cannot be removed this way.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: entityPathParameters,
    responses: {
      '200': {
        description: 'Entity removed from your view.',
        content: jsonContent(v1ShareMutationSchema),
      },
    },
  },
  resendInvitation: {
    method: 'post',
    routePath: '/invitations/:invitationId/resend',
    openApiPath: '/shares/invitations/{invitationId}/resend',
    summary: 'Resend A Sharing Invitation',
    description: 'Queues another delivery attempt for a pending sharing invitation.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [uuidPathParameter('invitationId')],
    responses: {
      '200': {
        description: 'The invitation was queued for delivery.',
        content: jsonContent(v1ResentShareInvitationSchema),
      },
    },
  },
  revokeInvitation: {
    method: 'delete',
    routePath: '/invitations/:invitationId',
    openApiPath: '/shares/invitations/{invitationId}',
    summary: 'Revoke A Sharing Invitation',
    description: 'Revokes a pending sharing invitation.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [uuidPathParameter('invitationId')],
    responses: {
      '200': { description: 'Invitation revoked.', content: jsonContent(v1ShareMutationSchema) },
    },
  },
  resendEntityInvitationByEmail: {
    method: 'post',
    routePath: '/entity/:entityType/:entityId/invitations/by-email/:email/resend',
    openApiPath: '/shares/entity/{entityType}/{entityId}/invitations/by-email/{email}/resend',
    summary: 'Resend An Entity Invitation By Email',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: entityEmailPathParameters,
    responses: {
      '200': {
        description: 'Invitation queued.',
        content: jsonContent(v1ResentShareInvitationSchema),
      },
    },
  },
  revokeEntityInvitationByEmail: {
    method: 'delete',
    routePath: '/entity/:entityType/:entityId/invitations/by-email/:email',
    openApiPath: '/shares/entity/{entityType}/{entityId}/invitations/by-email/{email}',
    summary: 'Revoke An Entity Invitation By Email',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: entityEmailPathParameters,
    responses: {
      '200': { description: 'Invitation revoked.', content: jsonContent(v1ShareMutationSchema) },
    },
  },
  workspaceSummary: {
    method: 'get',
    routePath: '/workspace',
    openApiPath: '/shares/workspace',
    summary: 'Get Workspace Sharing Settings',
    description:
      'Lists the authenticated owner’s workspace members and pending invitations, along with workspaces they have joined.',
    tags: sharesTag,
    requiredScopes: ['pages:read'],
    responses: {
      '200': {
        description: 'Workspace members, joined workspaces, and pending invitations.',
        content: jsonContent(v1WorkspaceSharingSummarySchema),
      },
    },
  },
  addWorkspaceMember: {
    method: 'post',
    routePath: '/workspace/members',
    openApiPath: '/shares/workspace/members',
    summary: 'Add Or Invite A Workspace Member',
    description:
      'Adds an existing Metakip user to the owner’s workspace or sends an invitation by email. Only the workspace owner can add members.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    request: { required: true, ...jsonContent(v1WorkspaceAddMemberRequestSchema) },
    responses: {
      '200': {
        description: 'An existing user was added to the workspace.',
        content: jsonContent(v1WorkspaceMemberAddedSchema),
      },
      '202': {
        description: 'An invitation was queued for an email address without an account.',
        content: jsonContent(v1WorkspaceMemberAddedSchema),
      },
    },
  },
  updateWorkspaceMember: {
    method: 'patch',
    routePath: '/workspace/members/:memberId',
    openApiPath: '/shares/workspace/members/{memberId}',
    summary: 'Update A Workspace Member Role',
    description: 'Changes a member’s workspace role. Only the workspace owner can update roles.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [uuidPathParameter('memberId')],
    request: { required: true, ...jsonContent(v1WorkspaceRoleRequestSchema) },
    responses: {
      '200': {
        description: 'Workspace role updated.',
        content: jsonContent(v1ShareMutationSchema),
      },
    },
  },
  removeWorkspaceMember: {
    method: 'delete',
    routePath: '/workspace/members/:memberId',
    openApiPath: '/shares/workspace/members/{memberId}',
    summary: 'Remove A Workspace Member',
    description: 'Removes a member from the authenticated owner’s workspace.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [uuidPathParameter('memberId')],
    responses: {
      '200': {
        description: 'Workspace member removed.',
        content: jsonContent(v1ShareMutationSchema),
      },
    },
  },
  updateWorkspaceMemberByEmail: {
    method: 'patch',
    routePath: '/workspace/members/by-email/:email',
    openApiPath: '/shares/workspace/members/by-email/{email}',
    summary: 'Update A Workspace Member By Email',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [emailPathParameter],
    request: { required: true, ...jsonContent(v1WorkspaceRoleRequestSchema) },
    responses: {
      '200': {
        description: 'Workspace role updated.',
        content: jsonContent(v1ShareMutationSchema),
      },
    },
  },
  removeWorkspaceMemberByEmail: {
    method: 'delete',
    routePath: '/workspace/members/by-email/:email',
    openApiPath: '/shares/workspace/members/by-email/{email}',
    summary: 'Remove A Workspace Member By Email',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [emailPathParameter],
    responses: {
      '200': {
        description: 'Workspace member removed.',
        content: jsonContent(v1ShareMutationSchema),
      },
    },
  },
  resendWorkspaceInvitationByEmail: {
    method: 'post',
    routePath: '/workspace/invitations/by-email/:email/resend',
    openApiPath: '/shares/workspace/invitations/by-email/{email}/resend',
    summary: 'Resend A Workspace Invitation By Email',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [emailPathParameter],
    responses: {
      '200': {
        description: 'Invitation queued.',
        content: jsonContent(v1ResentShareInvitationSchema),
      },
    },
  },
  revokeWorkspaceInvitationByEmail: {
    method: 'delete',
    routePath: '/workspace/invitations/by-email/:email',
    openApiPath: '/shares/workspace/invitations/by-email/{email}',
    summary: 'Revoke A Workspace Invitation By Email',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [emailPathParameter],
    responses: {
      '200': { description: 'Invitation revoked.', content: jsonContent(v1ShareMutationSchema) },
    },
  },
  leaveWorkspace: {
    method: 'delete',
    routePath: '/workspace/memberships/:ownerId',
    openApiPath: '/shares/workspace/memberships/{ownerId}',
    summary: 'Leave A Workspace',
    description: 'Removes the authenticated user from a workspace owned by another user.',
    tags: sharesTag,
    requiredScopes: ['pages:write'],
    parameters: [uuidPathParameter('ownerId')],
    responses: {
      '200': {
        description: 'Workspace left.',
        content: jsonContent(v1ShareMutationSchema),
      },
    },
  },
} as const satisfies Record<string, V1OperationContract>;
