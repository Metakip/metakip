import { hashMcpAccessToken } from '@metakip/shared/node/mcp-internal-auth';
import { describe, expect, it, vi } from 'vitest';
import type { McpActor } from './types';
import { V1SharingClient } from './v1ClientSharing';
import type { V1ClientIO, V1ClientRequestOptions } from './v1ClientTransport';

const actor: McpActor = {
  authContext: {
    userId: '00000000-0000-4000-8000-000000000001',
    connectionId: 'session:session-1:client:client-1:user:user-1',
    clientId: 'client-1',
    sessionId: 'session-1',
    accessTokenHash: hashMcpAccessToken('oauth-token'),
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3_600,
    offlineAccess: false,
    scopes: ['pages:read', 'pages:write'],
  },
  apiInternalSecret: 'test-mcp-api-internal-secret-0123456789',
};

const pageId = '00000000-0000-4000-8000-000000000002';
const invitationId = '00000000-0000-4000-8000-000000000003';
const workspaceOwnerId = '00000000-0000-4000-8000-000000000006';
const summary = {
  visibility: 'full',
  collaborators: [],
  entity: { type: 'page', id: pageId, title: 'Notes', ownerId: actor.authContext.userId },
  publicAccess: { permission: 'private', url: 'https://app.example.com/notes' },
  inheritance: { policy: 'inherit' },
  grants: [],
  pendingInvitations: [],
  accessors: [],
  accessSources: [],
  inheritedPublicAccess: [],
  userPermission: 'edit',
  capabilities: { canEdit: true, canDelete: false, canCopy: true, canComment: true },
  permissionDetails: [],
  inheritedAccessors: [],
};

describe('V1SharingClient', () => {
  it('resolves entity references before reading sharing settings', async () => {
    const io = createIo();
    const resolvePage = vi.fn().mockResolvedValue({ id: pageId });
    const client = new V1SharingClient(io, resolvePage, vi.fn());

    await expect(client.getSharingSummary(actor, 'page', 'Notes')).resolves.toMatchObject({
      entity: { id: pageId, title: 'Notes' },
    });
    expect(resolvePage).toHaveBeenCalledWith(actor, 'Notes', undefined);
    expect(io.send).toHaveBeenCalledWith(actor, `/shares/entity/page/${pageId}`, {}, undefined);
  });

  it('accepts a limited summary without a fabricated inheritance policy', async () => {
    const io = createIo();
    const limitedSummary = {
      ...summary,
      visibility: 'limited',
      entity: { ...summary.entity, ownerId: null },
    };
    Reflect.deleteProperty(limitedSummary, 'inheritance');
    vi.mocked(io.readJson).mockResolvedValueOnce(limitedSummary);
    const client = new V1SharingClient(io, vi.fn().mockResolvedValue({ id: pageId }), vi.fn());

    const result = await client.getSharingSummary(actor, 'page', pageId);
    expect(result).toMatchObject({
      visibility: 'limited',
      entity: { ownerId: null },
    });
    expect(result).not.toHaveProperty('inheritance');
  });

  it('creates a direct share or email invitation using the v1 route', async () => {
    const io = createIo();
    const client = new V1SharingClient(io, vi.fn().mockResolvedValue({ id: pageId }), vi.fn());

    await expect(
      client.grantEntityAccess(actor, 'page', pageId, {
        email: 'reader@example.com',
        permission: 'view',
      }),
    ).resolves.toEqual({ ok: true, message: 'Granted access' });
    expect(io.send).toHaveBeenCalledWith(
      actor,
      `/shares/entity/page/${pageId}/grants`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'reader@example.com', permission: 'view' }),
      },
      undefined,
    );
  });

  it('validates invitation details when a grant request queues an invitation', async () => {
    const io = createIo();
    const client = new V1SharingClient(io, vi.fn().mockResolvedValue({ id: pageId }), vi.fn());
    const invitation = {
      id: invitationId,
      targetType: 'page',
      targetId: pageId,
      email: 'reader@example.com',
      permission: 'view',
      canManage: true,
      deliveryStatus: 'pending',
      expiresAt: '2027-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    io.setMutationValue({ ok: true, message: 'Invitation queued', invitation });
    await expect(
      client.grantEntityAccess(actor, 'page', pageId, {
        email: invitation.email,
        permission: 'view',
      }),
    ).resolves.toMatchObject({ invitation: { id: invitationId } });

    io.setMutationValue({
      ok: true,
      message: 'Invitation queued',
      invitation: { ...invitation, id: 'not-a-uuid' },
    });
    await expect(
      client.grantEntityAccess(actor, 'page', pageId, {
        email: invitation.email,
        permission: 'view',
      }),
    ).rejects.toMatchObject({ code: 'invalid_upstream_response' });
  });

  it('sets public access and returns the canonical public URL', async () => {
    const io = createIo();
    io.setMutationValue({
      permission: 'view',
      url: 'https://app.example.com/notes',
      message: 'Notes is now public view only',
    });
    const client = new V1SharingClient(io, vi.fn().mockResolvedValue({ id: pageId }), vi.fn());

    await expect(client.updatePublicAccess(actor, 'page', 'Notes', 'view')).resolves.toMatchObject({
      permission: 'view',
      url: 'https://app.example.com/notes',
    });
    expect(io.send).toHaveBeenCalledWith(
      actor,
      `/shares/entity/page/${pageId}/public-access`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission: 'view' }),
      },
      undefined,
    );
  });

  it('leaves a shared page by reference without requiring a grant ID', async () => {
    const io = createIo();
    io.setMutationValue({ ok: true, message: 'Removed from your view' });
    const resolvePage = vi.fn().mockResolvedValue({ id: pageId });
    const client = new V1SharingClient(io, resolvePage, vi.fn());

    await expect(client.leaveSharedEntity(actor, 'page', 'Notes')).resolves.toEqual({
      ok: true,
      message: 'Removed from your view',
    });
    expect(resolvePage).toHaveBeenCalledWith(actor, 'Notes', undefined);
    expect(io.send).toHaveBeenCalledWith(
      actor,
      `/shares/entity/page/${pageId}/leave`,
      { method: 'POST' },
      undefined,
    );
  });

  it('resolves direct share mutations by recipient email', async () => {
    const io = createIo();
    const client = new V1SharingClient(io, vi.fn().mockResolvedValue({ id: pageId }), vi.fn());

    await client.updateSharePermission(actor, 'page', 'Notes', 'reader@example.com', 'edit');
    await client.revokeShare(actor, 'page', 'Notes', 'reader@example.com');

    expect(io.send).toHaveBeenCalledWith(
      actor,
      `/shares/entity/page/${pageId}/grants/by-email/reader%40example.com`,
      expect.objectContaining({ method: 'PATCH' }),
      undefined,
    );
    expect(io.send).toHaveBeenCalledWith(
      actor,
      `/shares/entity/page/${pageId}/grants/by-email/reader%40example.com`,
      { method: 'DELETE' },
      undefined,
    );
    expect(io.readJson).not.toHaveBeenCalled();
  });

  it('resolves page invitation mutations by recipient email', async () => {
    const io = createIo();
    const client = new V1SharingClient(io, vi.fn().mockResolvedValue({ id: pageId }), vi.fn());

    io.setMutationValue({
      invitation: {
        id: invitationId,
        targetType: 'page',
        targetId: pageId,
        email: 'reader@example.com',
        permission: 'view',
        canManage: true,
        deliveryStatus: 'sent',
        expiresAt: '2027-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      message: 'Invitation resent',
    });
    await client.resendSharingInvitation(actor, 'page', 'Notes', 'READER@example.com');
    io.setMutationValue({ ok: true, message: 'Invitation canceled' });
    await client.cancelSharingInvitation(actor, 'page', 'Notes', 'reader@example.com');

    expect(io.send).toHaveBeenCalledWith(
      actor,
      `/shares/entity/page/${pageId}/invitations/by-email/READER%40example.com/resend`,
      { method: 'POST' },
      undefined,
    );
    expect(io.send).toHaveBeenCalledWith(
      actor,
      `/shares/entity/page/${pageId}/invitations/by-email/reader%40example.com`,
      { method: 'DELETE' },
      undefined,
    );
    expect(io.readJson).not.toHaveBeenCalled();
  });

  it('supports workspace membership and invitations by email', async () => {
    const io = createIo();
    const client = new V1SharingClient(io, vi.fn(), vi.fn());

    await client.addWorkspaceMember(actor, 'new@example.com', 'commenter');
    await client.updateWorkspaceMember(actor, 'READER@example.com', 'editor');
    await client.removeWorkspaceMember(actor, 'reader@example.com');
    await client.leaveWorkspace(actor, workspaceOwnerId);
    io.setMutationValue({
      invitation: {
        id: invitationId,
        targetType: 'workspace',
        targetId: actor.authContext.userId,
        email: 'invitee@example.com',
        permission: 'commenter',
        canManage: true,
        deliveryStatus: 'sent',
        expiresAt: '2027-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      message: 'Invitation resent',
    });
    await client.resendWorkspaceInvitation(actor, 'INVITEE@example.com');
    io.setMutationValue({ ok: true, message: 'Invitation canceled' });
    await client.cancelWorkspaceInvitation(actor, 'invitee@example.com');

    expect(io.send).toHaveBeenCalledWith(
      actor,
      '/shares/workspace/members',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', role: 'commenter' }),
      },
      undefined,
    );
    expect(io.send).toHaveBeenCalledWith(
      actor,
      '/shares/workspace/members/by-email/READER%40example.com',
      expect.objectContaining({ method: 'PATCH' }),
      undefined,
    );
    expect(io.send).toHaveBeenCalledWith(
      actor,
      '/shares/workspace/members/by-email/reader%40example.com',
      { method: 'DELETE' },
      undefined,
    );
    expect(io.send).toHaveBeenCalledWith(
      actor,
      `/shares/workspace/memberships/${workspaceOwnerId}`,
      { method: 'DELETE' },
      undefined,
    );
    expect(io.send).toHaveBeenCalledWith(
      actor,
      '/shares/workspace/invitations/by-email/INVITEE%40example.com/resend',
      { method: 'POST' },
      undefined,
    );
    expect(io.send).toHaveBeenCalledWith(
      actor,
      '/shares/workspace/invitations/by-email/invitee%40example.com',
      { method: 'DELETE' },
      undefined,
    );
    expect(io.readJson).not.toHaveBeenCalled();
  });
});

function createIo(): V1ClientIO & { setMutationValue(value: unknown): void } {
  let mutationValue: unknown = { ok: true, message: 'Granted access' };
  const io: V1ClientIO = {
    send: vi.fn(
      async (
        _actor: McpActor,
        _path: string,
        _options?: V1ClientRequestOptions,
        _signal?: AbortSignal,
      ) => new Response(null),
    ),
    readJson: vi.fn(async () => summary),
    readMutationJson: async <T>(_response: Response, parse: (value: unknown) => T) =>
      parse(mutationValue),
    readBytes: vi.fn(async () => Buffer.alloc(0)),
    readBinaryOrMarkdown: vi.fn(async () => Buffer.alloc(0)),
    discardResponse: vi.fn(async () => undefined),
  };
  return Object.assign(io, {
    setMutationValue(value: unknown) {
      mutationValue = value;
    },
  });
}
