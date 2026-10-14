import { z } from 'zod';
import { v1UuidSchema } from './v1.js';

export const v1ShareEntityTypeSchema = z.enum(['page', 'folder']);
export const v1SharePermissionSchema = z.enum(['view', 'commenter', 'edit', 'admin']);
export const v1WorkspaceRoleSchema = z.enum(['viewer', 'commenter', 'editor', 'admin']);
export const v1PublicSharePermissionSchema = z.enum(['private', 'view', 'edit']);
export const v1SharingInheritancePolicySchema = z.enum(['inherit', 'restricted']);
const dateTimeSchema = z.iso.datetime({ offset: true });

const entityShareSchema = z
  .object({
    id: v1UuidSchema,
    entityType: v1ShareEntityTypeSchema,
    entityId: v1UuidSchema,
    permission: v1SharePermissionSchema,
    recipientUserId: v1UuidSchema,
    recipientEmail: z.string().nullable(),
    recipientName: z.string().nullable(),
    recipientAvatarUrl: z.string().nullable(),
    sharedByName: z.string().nullable(),
    sharedByEmail: z.string().nullable(),
    createdAt: dateTimeSchema.nullable(),
    updatedAt: dateTimeSchema.nullable(),
  })
  .strict();

export const v1ShareInvitationSchema = z
  .object({
    id: v1UuidSchema,
    targetType: v1ShareEntityTypeSchema,
    targetId: v1UuidSchema,
    email: z.email(),
    permission: v1SharePermissionSchema,
    canManage: z.boolean(),
    deliveryStatus: z.enum(['pending', 'sent', 'failed']),
    expiresAt: dateTimeSchema,
    createdAt: dateTimeSchema,
  })
  .strict();

const collaboratorSchema = z
  .object({
    userId: v1UuidSchema,
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    permission: v1SharePermissionSchema,
    isOwner: z.boolean(),
  })
  .strict();

const accessSourceSchema = z
  .object({
    kind: z.enum(['owner', 'direct', 'folder', 'workspace']),
    grantId: v1UuidSchema.nullable(),
    userId: v1UuidSchema,
    name: z.string().nullable(),
    email: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    permission: v1SharePermissionSchema,
    effectivePermission: v1SharePermissionSchema,
    isWinning: z.boolean(),
    isOwner: z.boolean(),
    isManageable: z.boolean(),
    folderId: v1UuidSchema.nullable().optional(),
    folderName: z.string().nullable().optional(),
  })
  .strict();

const accessorSchema = z
  .object({
    grantId: v1UuidSchema.nullable(),
    userId: v1UuidSchema,
    name: z.string().nullable(),
    email: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    permission: v1SharePermissionSchema,
    source: z.string(),
    isOwner: z.boolean(),
  })
  .strict();

const entitySchema = z
  .object({
    type: v1ShareEntityTypeSchema,
    id: v1UuidSchema,
    title: z.string(),
    ownerId: v1UuidSchema.nullable(),
  })
  .strict();

const summaryFields = z
  .object({
    collaborators: z.array(collaboratorSchema),
    entity: entitySchema,
    publicAccess: z.object({ permission: v1PublicSharePermissionSchema, url: z.url() }).strict(),
    grants: z.array(entityShareSchema),
    pendingInvitations: z.array(v1ShareInvitationSchema).optional(),
    accessors: z.array(accessorSchema),
    accessSources: z.array(accessSourceSchema),
    inheritedPublicAccess: z.array(
      z
        .object({
          entityId: v1UuidSchema,
          entityTitle: z.string(),
          permission: z.enum(['view', 'edit']),
          url: z.url(),
        })
        .strict(),
    ),
    userPermission: v1SharePermissionSchema.nullable(),
    capabilities: z
      .object({
        canEdit: z.boolean(),
        canDelete: z.boolean(),
        canCopy: z.boolean(),
        canComment: z.boolean(),
      })
      .strict(),
    permissionDetails: z.array(
      z
        .object({
          source: z.enum(['owner', 'grant', 'folder', 'workspace', 'public']),
          permission: v1SharePermissionSchema,
          folderId: v1UuidSchema.optional(),
          folderName: z.string().optional(),
        })
        .strict(),
    ),
    inheritedAccessors: z.array(
      z
        .object({
          userId: v1UuidSchema,
          name: z.string().nullable(),
          email: z.string().nullable(),
          permission: v1SharePermissionSchema,
          source: z.enum(['folder', 'workspace']),
          folderId: v1UuidSchema.optional(),
          folderName: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export const v1SharingSummarySchema = z.discriminatedUnion('visibility', [
  summaryFields
    .extend({
      visibility: z.literal('full'),
      inheritance: z.object({ policy: v1SharingInheritancePolicySchema }).strict(),
    })
    .strict(),
  summaryFields
    .extend({
      visibility: z.literal('limited'),
      entity: entitySchema.extend({ ownerId: z.null() }),
    })
    .strict(),
]);
export type V1SharingSummary = z.infer<typeof v1SharingSummarySchema>;

const workspaceMemberSchema = z
  .object({
    id: v1UuidSchema,
    workspaceOwnerId: v1UuidSchema,
    memberId: v1UuidSchema,
    memberName: z.string().nullable(),
    memberEmail: z.email(),
    memberAvatarUrl: z.string().nullable(),
    role: v1WorkspaceRoleSchema,
    createdAt: dateTimeSchema,
  })
  .strict();

const workspaceMembershipSchema = z
  .object({
    ownerId: v1UuidSchema,
    ownerName: z.string().nullable(),
    role: v1WorkspaceRoleSchema,
    joinedAt: dateTimeSchema,
  })
  .strict();

const workspaceInvitationSchema = z
  .object({
    id: v1UuidSchema,
    targetType: z.literal('workspace'),
    targetId: v1UuidSchema,
    email: z.email(),
    permission: v1WorkspaceRoleSchema,
    canManage: z.boolean(),
    deliveryStatus: z.enum(['pending', 'sent', 'failed']),
    expiresAt: dateTimeSchema,
    createdAt: dateTimeSchema,
  })
  .strict();

export const v1WorkspaceSharingSummarySchema = z
  .object({
    ownerId: v1UuidSchema,
    ownerName: z.string().nullable(),
    members: z.array(workspaceMemberSchema),
    memberships: z.array(workspaceMembershipSchema),
    pendingInvitations: z.array(workspaceInvitationSchema),
  })
  .strict();
export type V1WorkspaceSharingSummary = z.infer<typeof v1WorkspaceSharingSummarySchema>;

export const v1UpdateInheritanceRequestSchema = z
  .object({ policy: v1SharingInheritancePolicySchema })
  .strict();
export const v1UpdatePublicAccessRequestSchema = z
  .object({ permission: v1PublicSharePermissionSchema })
  .strict();
export const v1CreateShareGrantRequestSchema = z
  .object({
    email: z.string().trim().pipe(z.email().max(320)),
    permission: v1SharePermissionSchema,
  })
  .strict();
export const v1UpdateShareGrantRequestSchema = z
  .object({ permission: v1SharePermissionSchema })
  .strict();
export const v1WorkspaceAddMemberRequestSchema = z
  .object({
    email: z.string().trim().pipe(z.email().max(320)),
    role: v1WorkspaceRoleSchema,
  })
  .strict();
export const v1WorkspaceRoleRequestSchema = z.object({ role: v1WorkspaceRoleSchema }).strict();

export const v1ShareMutationSchema = z
  .object({ ok: z.literal(true), message: z.string() })
  .strict();
export type V1ShareMutation = z.infer<typeof v1ShareMutationSchema>;

export const v1WorkspaceMemberAddedSchema = z
  .object({
    ok: z.literal(true),
    memberId: v1UuidSchema.optional(),
    name: z.string().nullable().optional(),
    invitation: workspaceInvitationSchema.optional(),
    message: z.string(),
  })
  .strict();
export type V1WorkspaceMemberAdded = z.infer<typeof v1WorkspaceMemberAddedSchema>;
export const v1ShareInvitationQueuedSchema = v1ShareMutationSchema
  .extend({ invitation: v1ShareInvitationSchema })
  .strict();
export const v1ShareGrantResponseSchema = z.union([
  v1ShareMutationSchema,
  v1ShareInvitationQueuedSchema,
]);
export type V1ShareGrantResponse = z.infer<typeof v1ShareGrantResponseSchema>;
export const v1SharePublicAccessSchema = z
  .object({ permission: v1PublicSharePermissionSchema, url: z.url(), message: z.string() })
  .strict();
export type V1SharePublicAccess = z.infer<typeof v1SharePublicAccessSchema>;
export const v1ShareInheritanceSchema = z
  .object({ policy: v1SharingInheritancePolicySchema, message: z.string() })
  .strict();
export type V1ShareInheritance = z.infer<typeof v1ShareInheritanceSchema>;
export const v1ResentShareInvitationSchema = z
  .object({
    invitation: z.union([v1ShareInvitationSchema, workspaceInvitationSchema]),
    message: z.string(),
  })
  .strict();
export type V1ResentShareInvitation = z.infer<typeof v1ResentShareInvitationSchema>;
