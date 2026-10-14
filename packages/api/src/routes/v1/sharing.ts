import { Hono } from 'hono';
import {
  recordTokenAuditEventBestEffort,
  requireV1Auth,
  requireV1OperationScope,
} from '../../middleware/v1Auth';
import { removeFolderFromView, removePageFromView } from '../../utils/entityRemoval';
import {
  grantOrInviteEntity,
  grantOrInviteWorkspaceMember,
  resendManagedInvitation,
  resendManagedInvitationByEmail,
  revokeManagedInvitation,
  revokeManagedInvitationByEmail,
} from '../../utils/invitationAccess';
import { parseEntityType, parsePermission, parsePublicPermission } from '../../utils/share-access';
import {
  getShareSummary,
  revokeShareGrant,
  revokeShareGrantByEmail,
  updatePublicAccess,
  updateShareGrantPermission,
  updateShareGrantPermissionByEmail,
  updateSharingInheritance,
} from '../../utils/shareManagement';
import { requireUuid } from '../../utils/uuid';
import {
  getWorkspaceSharingSummary,
  leaveWorkspace,
  removeWorkspaceMember,
  removeWorkspaceMemberByEmail,
  updateWorkspaceMemberRole,
  updateWorkspaceMemberRoleByEmail,
} from '../../utils/workspaceSharing';
import { v1JsonBodyLimit } from './requestLimits';
import { parseJsonRequest } from './requestValidation';
import {
  addWorkspaceMemberRequestSchema,
  createShareGrantRequestSchema,
  sharingOperations,
  updateInheritanceRequestSchema,
  updatePublicAccessRequestSchema,
  updateShareGrantRequestSchema,
  workspaceRoleRequestSchema,
} from './sharingContracts';

const sharingV1Route = new Hono();
sharingV1Route.use('*', requireV1Auth);

sharingV1Route.get(
  sharingOperations.summary.routePath,
  requireV1OperationScope(sharingOperations.summary),
  async (c) => {
    const entityType = parseEntityType(c.req.param('entityType'));
    const entityId = requireUuid(c.req.param('entityId'), 'entity ID');
    const summary = await getShareSummary(entityType, entityId, c.get('v1Principal').userId);
    if (summary.visibility === 'limited') {
      // The legacy web response carries a placeholder; it is not the entity's actual policy.
      const { inheritance: _hiddenInheritance, ...limited } = summary;
      return c.json(limited);
    }
    return c.json(summary);
  },
);

sharingV1Route.patch(
  sharingOperations.updateInheritance.routePath,
  requireV1OperationScope(sharingOperations.updateInheritance),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const entityType = parseEntityType(c.req.param('entityType'));
    const entityId = requireUuid(c.req.param('entityId'), 'entity ID');
    const { policy } = await parseJsonRequest(c, updateInheritanceRequestSchema);
    const result = await updateSharingInheritance(entityType, entityId, principal.userId, policy);
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json(result);
  },
);

sharingV1Route.patch(
  sharingOperations.updatePublicAccess.routePath,
  requireV1OperationScope(sharingOperations.updatePublicAccess),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const entityType = parseEntityType(c.req.param('entityType'));
    const entityId = requireUuid(c.req.param('entityId'), 'entity ID');
    const { permission: requestedPermission } = await parseJsonRequest(
      c,
      updatePublicAccessRequestSchema,
    );
    const permission =
      requestedPermission === 'private' ? null : parsePublicPermission(requestedPermission);
    const result = await updatePublicAccess(entityType, entityId, principal.userId, permission);
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json(result);
  },
);

sharingV1Route.post(
  sharingOperations.createGrant.routePath,
  requireV1OperationScope(sharingOperations.createGrant),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const entityType = parseEntityType(c.req.param('entityType'));
    const entityId = requireUuid(c.req.param('entityId'), 'entity ID');
    const request = await parseJsonRequest(c, createShareGrantRequestSchema);
    const result = await grantOrInviteEntity({
      actorId: principal.userId,
      targetType: entityType,
      targetId: entityId,
      email: request.email,
      permission: parsePermission(request.permission),
    });
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    if (result.kind === 'invitation') {
      return c.json(
        {
          ok: true,
          invitation: result.invitation,
          message: `Invitation queued for ${result.invitation.email}`,
        },
        202,
      );
    }
    return c.json({ ok: true, message: result.message });
  },
);

sharingV1Route.patch(
  sharingOperations.updateGrant.routePath,
  requireV1OperationScope(sharingOperations.updateGrant),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const grantId = requireUuid(c.req.param('grantId'), 'grant ID');
    const { permission } = await parseJsonRequest(c, updateShareGrantRequestSchema);
    const result = await updateShareGrantPermission(
      grantId,
      principal.userId,
      parsePermission(permission),
    );
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: result.message });
  },
);

sharingV1Route.delete(
  sharingOperations.revokeGrant.routePath,
  requireV1OperationScope(sharingOperations.revokeGrant),
  async (c) => {
    const principal = c.get('v1Principal');
    const grantId = requireUuid(c.req.param('grantId'), 'grant ID');
    const result = await revokeShareGrant(grantId, principal.userId);
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: result.message });
  },
);

sharingV1Route.patch(
  sharingOperations.updateGrantByEmail.routePath,
  requireV1OperationScope(sharingOperations.updateGrantByEmail),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const entityType = parseEntityType(c.req.param('entityType'));
    const entityId = requireUuid(c.req.param('entityId'), 'entity ID');
    const { permission } = await parseJsonRequest(c, updateShareGrantRequestSchema);
    const result = await updateShareGrantPermissionByEmail(
      entityType,
      entityId,
      principal.userId,
      c.req.param('email'),
      permission,
    );
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: result.message });
  },
);

sharingV1Route.delete(
  sharingOperations.revokeGrantByEmail.routePath,
  requireV1OperationScope(sharingOperations.revokeGrantByEmail),
  async (c) => {
    const principal = c.get('v1Principal');
    const result = await revokeShareGrantByEmail(
      parseEntityType(c.req.param('entityType')),
      requireUuid(c.req.param('entityId'), 'entity ID'),
      principal.userId,
      c.req.param('email'),
    );
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: result.message });
  },
);

sharingV1Route.post(
  sharingOperations.leaveEntity.routePath,
  requireV1OperationScope(sharingOperations.leaveEntity),
  async (c) => {
    const principal = c.get('v1Principal');
    const entityType = parseEntityType(c.req.param('entityType'));
    const entityId = requireUuid(c.req.param('entityId'), 'entity ID');
    if (entityType === 'page') {
      await removePageFromView(entityId, principal.userId);
    } else {
      await removeFolderFromView(entityId, principal.userId);
    }
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: 'Removed from your view' });
  },
);

sharingV1Route.post(
  sharingOperations.resendInvitation.routePath,
  requireV1OperationScope(sharingOperations.resendInvitation),
  async (c) => {
    const principal = c.get('v1Principal');
    const invitationId = requireUuid(c.req.param('invitationId'), 'invitation ID');
    const invitation = await resendManagedInvitation(invitationId, principal.userId);
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ invitation, message: `Invitation queued for ${invitation.email}` });
  },
);

sharingV1Route.delete(
  sharingOperations.revokeInvitation.routePath,
  requireV1OperationScope(sharingOperations.revokeInvitation),
  async (c) => {
    const principal = c.get('v1Principal');
    const invitationId = requireUuid(c.req.param('invitationId'), 'invitation ID');
    const invitation = await revokeManagedInvitation(invitationId, principal.userId);
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: `Invitation to ${invitation.email} revoked` });
  },
);

sharingV1Route.post(
  sharingOperations.resendEntityInvitationByEmail.routePath,
  requireV1OperationScope(sharingOperations.resendEntityInvitationByEmail),
  async (c) => {
    const principal = c.get('v1Principal');
    const invitation = await resendManagedInvitationByEmail(
      parseEntityType(c.req.param('entityType')),
      requireUuid(c.req.param('entityId'), 'entity ID'),
      c.req.param('email'),
      principal.userId,
    );
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ invitation, message: `Invitation queued for ${invitation.email}` });
  },
);

sharingV1Route.delete(
  sharingOperations.revokeEntityInvitationByEmail.routePath,
  requireV1OperationScope(sharingOperations.revokeEntityInvitationByEmail),
  async (c) => {
    const principal = c.get('v1Principal');
    const invitation = await revokeManagedInvitationByEmail(
      parseEntityType(c.req.param('entityType')),
      requireUuid(c.req.param('entityId'), 'entity ID'),
      c.req.param('email'),
      principal.userId,
    );
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: `Invitation to ${invitation.email} revoked` });
  },
);

sharingV1Route.get(
  sharingOperations.workspaceSummary.routePath,
  requireV1OperationScope(sharingOperations.workspaceSummary),
  async (c) => {
    const summary = await getWorkspaceSharingSummary(c.get('v1Principal').userId);
    return c.json(summary);
  },
);

sharingV1Route.post(
  sharingOperations.addWorkspaceMember.routePath,
  requireV1OperationScope(sharingOperations.addWorkspaceMember),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const request = await parseJsonRequest(c, addWorkspaceMemberRequestSchema);
    const result = await grantOrInviteWorkspaceMember({
      ownerId: principal.userId,
      actorId: principal.userId,
      email: request.email,
      role: request.role,
    });
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    if (result.kind === 'invitation') {
      return c.json(
        {
          ok: true,
          invitation: result.invitation,
          message: `Invitation queued for ${result.invitation.email}`,
        },
        202,
      );
    }
    return c.json({
      ok: true,
      memberId: result.recipientId,
      name: result.recipientName,
      message: result.message,
    });
  },
);

sharingV1Route.patch(
  sharingOperations.updateWorkspaceMember.routePath,
  requireV1OperationScope(sharingOperations.updateWorkspaceMember),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const memberId = requireUuid(c.req.param('memberId'), 'member ID');
    const { role } = await parseJsonRequest(c, workspaceRoleRequestSchema);
    const result = await updateWorkspaceMemberRole(principal.userId, memberId, role);
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: result.message });
  },
);

sharingV1Route.delete(
  sharingOperations.removeWorkspaceMember.routePath,
  requireV1OperationScope(sharingOperations.removeWorkspaceMember),
  async (c) => {
    const principal = c.get('v1Principal');
    const memberId = requireUuid(c.req.param('memberId'), 'member ID');
    const result = await removeWorkspaceMember(principal.userId, memberId);
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: result.message });
  },
);

sharingV1Route.patch(
  sharingOperations.updateWorkspaceMemberByEmail.routePath,
  requireV1OperationScope(sharingOperations.updateWorkspaceMemberByEmail),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const { role } = await parseJsonRequest(c, workspaceRoleRequestSchema);
    const result = await updateWorkspaceMemberRoleByEmail(
      principal.userId,
      c.req.param('email'),
      role,
    );
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: result.message });
  },
);

sharingV1Route.delete(
  sharingOperations.removeWorkspaceMemberByEmail.routePath,
  requireV1OperationScope(sharingOperations.removeWorkspaceMemberByEmail),
  async (c) => {
    const principal = c.get('v1Principal');
    const result = await removeWorkspaceMemberByEmail(principal.userId, c.req.param('email'));
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: result.message });
  },
);

sharingV1Route.post(
  sharingOperations.resendWorkspaceInvitationByEmail.routePath,
  requireV1OperationScope(sharingOperations.resendWorkspaceInvitationByEmail),
  async (c) => {
    const principal = c.get('v1Principal');
    const invitation = await resendManagedInvitationByEmail(
      'workspace',
      principal.userId,
      c.req.param('email'),
      principal.userId,
    );
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ invitation, message: `Invitation queued for ${invitation.email}` });
  },
);

sharingV1Route.delete(
  sharingOperations.revokeWorkspaceInvitationByEmail.routePath,
  requireV1OperationScope(sharingOperations.revokeWorkspaceInvitationByEmail),
  async (c) => {
    const principal = c.get('v1Principal');
    const invitation = await revokeManagedInvitationByEmail(
      'workspace',
      principal.userId,
      c.req.param('email'),
      principal.userId,
    );
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: `Invitation to ${invitation.email} revoked` });
  },
);

sharingV1Route.delete(
  sharingOperations.leaveWorkspace.routePath,
  requireV1OperationScope(sharingOperations.leaveWorkspace),
  async (c) => {
    const principal = c.get('v1Principal');
    const ownerId = requireUuid(c.req.param('ownerId'), 'workspace owner ID');
    const result = await leaveWorkspace(principal.userId, ownerId);
    await recordTokenAuditEventBestEffort(principal, 'sharing.mutate', 'success', null);
    return c.json({ ok: true, message: result.message });
  },
);

export default sharingV1Route;
