import { describe, expect, it } from 'vitest';
import { testQuery } from '../../db/testQuery';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../../test-utils';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function createToken(app: TestApp, userId: string, scopes: string[]): Promise<string> {
  const session = await createTestSession(userId);
  const response = await app.request('/api/v1/tokens', {
    method: 'POST',
    headers: { Cookie: session.Cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sharing API test', scopes }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

const bearerJson = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

describe('v1 sharing API', () => {
  it('publishes the full sharing surface in OpenAPI', async () => {
    const app = await createTestApp();
    const response = await app.request('/api/v1/openapi.json');
    const document = (await response.json()) as {
      paths: Record<string, Record<string, { 'x-required-scopes'?: string[] }>>;
    };

    expect(response.status).toBe(200);
    expect(
      document.paths['/shares/entity/{entityType}/{entityId}']?.get?.['x-required-scopes'],
    ).toEqual(['pages:read']);
    expect(document.paths['/shares/entity/{entityType}/{entityId}/grants']?.post).toBeDefined();
    expect(document.paths['/shares/grants/{grantId}']).toEqual(
      expect.objectContaining({ patch: expect.any(Object), delete: expect.any(Object) }),
    );
    expect(
      document.paths['/shares/entity/{entityType}/{entityId}/grants/by-email/{email}'],
    ).toEqual(expect.objectContaining({ patch: expect.any(Object), delete: expect.any(Object) }));
    expect(document.paths['/shares/workspace/members/by-email/{email}']).toEqual(
      expect.objectContaining({ patch: expect.any(Object), delete: expect.any(Object) }),
    );
    expect(document.paths['/shares/invitations/{invitationId}']).toBeDefined();
    expect(document.paths['/shares/entity/{entityType}/{entityId}/leave']?.post).toBeDefined();
    expect(document.paths['/shares/workspace']?.get).toBeDefined();
    expect(document.paths['/shares/workspace/members']?.post).toBeDefined();
    expect(document.paths['/shares/workspace/members/{memberId}']).toEqual(
      expect.objectContaining({ patch: expect.any(Object), delete: expect.any(Object) }),
    );
  });

  it('manages workspace members and pending invitations through v1', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ email: 'v1-workspace-owner@example.com' });
    const member = await createTestUser({ email: 'v1-workspace-member@example.com' });
    const ownerToken = await createToken(app, owner.id, ['pages:write']);

    const initialSummary = await app.request('/api/v1/shares/workspace', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(initialSummary.status).toBe(200);
    expect(await initialSummary.json()).toMatchObject({
      ownerId: owner.id,
      members: [],
      pendingInvitations: [],
    });

    const addResponse = await app.request('/api/v1/shares/workspace/members', {
      method: 'POST',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ email: member.email, role: 'editor' }),
    });
    expect(addResponse.status).toBe(200);
    expect(await addResponse.json()).toMatchObject({ ok: true, memberId: member.id });

    const updateResponse = await app.request(`/api/v1/shares/workspace/members/${member.id}`, {
      method: 'PATCH',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ role: 'commenter' }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({ ok: true });

    const summary = await app.request('/api/v1/shares/workspace', {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const summaryBody = (await summary.json()) as {
      members: Array<{ memberId: string; role: string; createdAt: string }>;
      memberships: Array<{ joinedAt: string }>;
    };
    expect(summaryBody).toMatchObject({
      members: [expect.objectContaining({ memberId: member.id, role: 'commenter' })],
    });
    const workspaceMember = summaryBody.members[0];
    if (!workspaceMember) throw new Error('Workspace member was not returned');
    expect(new Date(workspaceMember.createdAt).toISOString()).toBe(workspaceMember.createdAt);

    const removeResponse = await app.request(`/api/v1/shares/workspace/members/${member.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(removeResponse.status).toBe(200);

    const invitationResponse = await app.request('/api/v1/shares/workspace/members', {
      method: 'POST',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ email: 'new-workspace-member@example.com', role: 'editor' }),
    });
    expect(invitationResponse.status).toBe(202);
    const invitationBody = (await invitationResponse.json()) as {
      invitation: { id: string; targetType: string };
    };
    expect(invitationBody.invitation.targetType).toBe('workspace');

    await testQuery(
      `update invitation_send_attempts
       set attempted_at = now() - interval '20 minutes'
       where invitation_id = $1`,
      [invitationBody.invitation.id],
    );

    const resendResponse = await app.request(
      `/api/v1/shares/invitations/${invitationBody.invitation.id}/resend`,
      { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    expect(resendResponse.status).toBe(200);
    expect(await resendResponse.json()).toMatchObject({
      invitation: { id: invitationBody.invitation.id, targetType: 'workspace' },
    });

    const cancelResponse = await app.request(
      `/api/v1/shares/invitations/${invitationBody.invitation.id}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    expect(cancelResponse.status).toBe(200);
  });

  it('allows a workspace member to leave through v1', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ email: 'v1-workspace-owner-leave@example.com' });
    const member = await createTestUser({ email: 'v1-workspace-member-leave@example.com' });
    await testQuery(
      `insert into workspace_members (workspace_owner_id, member_id, role)
       values ($1, $2, 'editor')`,
      [owner.id, member.id],
    );
    const memberToken = await createToken(app, member.id, ['pages:write']);

    const response = await app.request(`/api/v1/shares/workspace/memberships/${owner.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, message: 'Left the workspace' });
  });

  it('supports grant, permission update, and revocation through v1', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ email: 'v1-sharing-owner@example.com' });
    const recipient = await createTestUser({ email: 'v1-sharing-recipient@example.com' });
    const page = await createTestPage(owner.id, { title: 'V1 share target' });
    const ownerToken = await createToken(app, owner.id, ['pages:write']);
    const recipientToken = await createToken(app, recipient.id, ['pages:read']);
    const entityPath = `/api/v1/shares/entity/page/${page.id}`;

    const summaryBefore = await app.request(entityPath, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(summaryBefore.status).toBe(200);
    expect(await summaryBefore.json()).toMatchObject({
      visibility: 'full',
      entity: { id: page.id, ownerId: owner.id },
      grants: [],
    });

    const grantResponse = await app.request(`${entityPath}/grants`, {
      method: 'POST',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ email: recipient.email, permission: 'edit' }),
    });
    expect(grantResponse.status).toBe(200);
    expect(await grantResponse.json()).toMatchObject({
      ok: true,
      message: expect.stringContaining('Granted'),
    });

    const storedGrant = await testQuery<{ id: string }>(
      `select id from shares where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, recipient.id],
    );
    const grantId = storedGrant.rows[0]?.id;
    expect(grantId).toBeDefined();
    if (!grantId) throw new Error('Grant was not persisted');

    const recipientPage = await app.request(`/api/v1/pages/${page.id}`, {
      headers: { Authorization: `Bearer ${recipientToken}` },
    });
    expect(recipientPage.status).toBe(200);

    const updateResponse = await app.request(`/api/v1/shares/grants/${grantId}`, {
      method: 'PATCH',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ permission: 'commenter' }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({ ok: true });

    const updatedSummary = await app.request(entityPath, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const updatedSummaryBody = (await updatedSummary.json()) as {
      grants: Array<{
        id: string;
        permission: string;
        createdAt: string | null;
        updatedAt: string | null;
      }>;
    };
    expect(updatedSummaryBody).toMatchObject({
      grants: [expect.objectContaining({ id: grantId, permission: 'commenter' })],
    });
    const serializedGrant = updatedSummaryBody.grants[0];
    if (!serializedGrant?.createdAt || !serializedGrant.updatedAt) {
      throw new Error('Sharing summary did not return grant timestamps');
    }
    expect(new Date(serializedGrant.createdAt).toISOString()).toBe(serializedGrant.createdAt);
    expect(new Date(serializedGrant.updatedAt).toISOString()).toBe(serializedGrant.updatedAt);

    const revokeResponse = await app.request(`/api/v1/shares/grants/${grantId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(revokeResponse.status).toBe(200);
    expect(await revokeResponse.json()).toMatchObject({ ok: true });

    const recipientAfterRevoke = await app.request(`/api/v1/pages/${page.id}`, {
      headers: { Authorization: `Bearer ${recipientToken}` },
    });
    expect(recipientAfterRevoke.status).toBe(404);
  });

  it('changes direct shares by email without a client-side summary lookup', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser({ email: 'email-share-recipient@example.com' });
    const page = await createTestPage(owner.id);
    const ownerToken = await createToken(app, owner.id, ['pages:write']);
    const recipientToken = await createToken(app, recipient.id, ['pages:write']);
    const entityPath = `/api/v1/shares/entity/page/${page.id}`;
    const path = `${entityPath}/grants/by-email/EMAIL-SHARE-RECIPIENT%40example.com`;

    const grant = await app.request(`${entityPath}/grants`, {
      method: 'POST',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ email: recipient.email, permission: 'view' }),
    });
    expect(grant.status).toBe(200);

    const denied = await app.request(path, {
      method: 'PATCH',
      headers: bearerJson(recipientToken),
      body: JSON.stringify({ permission: 'edit' }),
    });
    expect(denied.status).toBe(403);

    const update = await app.request(path, {
      method: 'PATCH',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ permission: 'commenter' }),
    });
    expect(update.status).toBe(200);
    const stored = await testQuery<{ permission: string }>(
      'select permission from shares where entity_type = $1 and entity_id = $2 and recipient_user_id = $3',
      ['page', page.id, recipient.id],
    );
    expect(stored.rows[0]?.permission).toBe('commenter');

    const revoke = await app.request(path, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(revoke.status).toBe(200);
    const missing = await app.request(path, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(missing.status).toBe(404);
  });

  it('resolves invitations and workspace members by email inside the API', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const member = await createTestUser({ email: 'email-workspace-member@example.com' });
    const page = await createTestPage(owner.id);
    const token = await createToken(app, owner.id, ['pages:write']);
    const entityPath = `/api/v1/shares/entity/page/${page.id}`;
    const email = 'EMAIL-INVITEE%40example.com';
    const invite = await app.request(`${entityPath}/grants`, {
      method: 'POST',
      headers: bearerJson(token),
      body: JSON.stringify({ email: 'email-invitee@example.com', permission: 'view' }),
    });
    expect(invite.status).toBe(202);
    const invitation = (await invite.json()) as { invitation: { id: string } };
    const pendingIsNotGrant = await app.request(`${entityPath}/grants/by-email/${email}`, {
      method: 'PATCH',
      headers: bearerJson(token),
      body: JSON.stringify({ permission: 'edit' }),
    });
    expect(pendingIsNotGrant.status).toBe(409);
    await testQuery(
      `update invitation_send_attempts set attempted_at = now() - interval '20 minutes'
       where invitation_id = $1`,
      [invitation.invitation.id],
    );
    const resend = await app.request(`${entityPath}/invitations/by-email/${email}/resend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resend.status).toBe(200);
    expect(await resend.json()).toMatchObject({ invitation: { id: invitation.invitation.id } });
    const revoke = await app.request(`${entityPath}/invitations/by-email/${email}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(revoke.status).toBe(200);

    const addMember = await app.request('/api/v1/shares/workspace/members', {
      method: 'POST',
      headers: bearerJson(token),
      body: JSON.stringify({ email: member.email, role: 'viewer' }),
    });
    expect(addMember.status).toBe(200);
    const memberPath =
      '/api/v1/shares/workspace/members/by-email/EMAIL-WORKSPACE-MEMBER%40example.com';
    const changeRole = await app.request(memberPath, {
      method: 'PATCH',
      headers: bearerJson(token),
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(changeRole.status).toBe(200);
    const removeMember = await app.request(memberPath, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(removeMember.status).toBe(200);

    const inviteWorkspace = await app.request('/api/v1/shares/workspace/members', {
      method: 'POST',
      headers: bearerJson(token),
      body: JSON.stringify({ email: 'email-workspace-invitee@example.com', role: 'viewer' }),
    });
    expect(inviteWorkspace.status).toBe(202);
    const workspaceInvitation = (await inviteWorkspace.json()) as { invitation: { id: string } };
    const pendingIsNotMember = await app.request(
      '/api/v1/shares/workspace/members/by-email/email-workspace-invitee%40example.com',
      {
        method: 'PATCH',
        headers: bearerJson(token),
        body: JSON.stringify({ role: 'editor' }),
      },
    );
    expect(pendingIsNotMember.status).toBe(409);
    await testQuery(
      `update invitation_send_attempts set attempted_at = now() - interval '20 minutes'
       where invitation_id = $1`,
      [workspaceInvitation.invitation.id],
    );
    const workspacePath =
      '/api/v1/shares/workspace/invitations/by-email/EMAIL-WORKSPACE-INVITEE%40example.com';
    const resendWorkspace = await app.request(`${workspacePath}/resend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resendWorkspace.status).toBe(200);
    const cancelWorkspace = await app.request(workspacePath, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cancelWorkspace.status).toBe(200);
  });

  it('creates, resends, and revokes pending invitations', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const page = await createTestPage(owner.id, { title: 'Invitation target' });
    const ownerToken = await createToken(app, owner.id, ['pages:write']);
    const entityPath = `/api/v1/shares/entity/page/${page.id}`;

    const createResponse = await app.request(`${entityPath}/grants`, {
      method: 'POST',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ email: 'new-collaborator@example.com', permission: 'view' }),
    });
    expect(createResponse.status).toBe(202);
    const created = (await createResponse.json()) as {
      invitation: { id: string; email: string };
    };
    expect(created.invitation.email).toBe('new-collaborator@example.com');

    const summary = await app.request(entityPath, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(await summary.json()).toMatchObject({
      pendingInvitations: [expect.objectContaining({ id: created.invitation.id, canManage: true })],
    });

    await testQuery(
      `update invitation_send_attempts
       set attempted_at = now() - interval '20 minutes'
       where invitation_id = $1`,
      [created.invitation.id],
    );

    const resend = await app.request(`/api/v1/shares/invitations/${created.invitation.id}/resend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(resend.status).toBe(200);
    expect(await resend.json()).toMatchObject({
      invitation: expect.objectContaining({ id: created.invitation.id }),
    });

    const revoke = await app.request(`/api/v1/shares/invitations/${created.invitation.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ ok: true });
  });

  it('lets recipients remove their own page and folder grants without knowing grant IDs', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const page = await createTestPage(owner.id);
    const folder = await createTestFolder(owner.id);
    const ownerToken = await createToken(app, owner.id, ['pages:write']);
    const recipientToken = await createToken(app, recipient.id, ['pages:write']);

    for (const [entityType, entityId] of [
      ['page', page.id],
      ['folder', folder.id],
    ] as const) {
      const path = `/api/v1/shares/entity/${entityType}/${entityId}`;
      const grant = await app.request(`${path}/grants`, {
        method: 'POST',
        headers: bearerJson(ownerToken),
        body: JSON.stringify({ email: recipient.email, permission: 'view' }),
      });
      expect(grant.status).toBe(200);

      const limited = await app.request(path, {
        headers: { Authorization: `Bearer ${recipientToken}` },
      });
      expect(await limited.json()).toMatchObject({ visibility: 'limited', grants: [] });

      const leave = await app.request(`${path}/leave`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${recipientToken}` },
      });
      expect(leave.status).toBe(200);
      expect(await leave.json()).toEqual({ ok: true, message: 'Removed from your view' });

      const remaining = await testQuery<{ count: string }>(
        'select count(*)::text as count from shares where entity_type = $1 and entity_id = $2 and recipient_user_id = $3',
        [entityType, entityId, recipient.id],
      );
      expect(remaining.rows[0]?.count).toBe('0');

      const inaccessible = await app.request(`/api/v1/${entityType}s/${entityId}`, {
        headers: { Authorization: `Bearer ${recipientToken}` },
      });
      expect(inaccessible.status).toBe(entityType === 'page' ? 404 : 403);
    }

    const ownerLeave = await app.request(`/api/v1/shares/entity/page/${page.id}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerLeave.status).toBe(400);

    const readOnlyToken = await createToken(app, recipient.id, ['pages:read']);
    const insufficientScope = await app.request(`/api/v1/shares/entity/page/${page.id}/leave`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${readOnlyToken}` },
    });
    expect(insufficientScope.status).toBe(403);
  });

  it('updates public access and inheritance for folders and pages', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const folder = await createTestFolder(owner.id, { name: 'Shared folder' });
    const page = await createTestPage(owner.id, { title: 'Restricted child', parentId: folder.id });
    const ownerToken = await createToken(app, owner.id, ['pages:write']);

    const publicResponse = await app.request(
      `/api/v1/shares/entity/folder/${folder.id}/public-access`,
      {
        method: 'PATCH',
        headers: bearerJson(ownerToken),
        body: JSON.stringify({ permission: 'view' }),
      },
    );
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toMatchObject({
      permission: 'view',
      url: expect.any(String),
    });

    const folderGrant = await app.request(`/api/v1/shares/entity/folder/${folder.id}/grants`, {
      method: 'POST',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ email: recipient.email, permission: 'edit' }),
    });
    expect(folderGrant.status).toBe(200);

    const folderSummary = await app.request(`/api/v1/shares/entity/folder/${folder.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(await folderSummary.json()).toMatchObject({
      grants: [expect.objectContaining({ recipientUserId: recipient.id, permission: 'edit' })],
    });

    const inheritanceResponse = await app.request(
      `/api/v1/shares/entity/page/${page.id}/inheritance`,
      {
        method: 'PATCH',
        headers: bearerJson(ownerToken),
        body: JSON.stringify({ policy: 'restricted' }),
      },
    );
    expect(inheritanceResponse.status).toBe(200);
    expect(await inheritanceResponse.json()).toMatchObject({ policy: 'restricted' });

    const privateResponse = await app.request(
      `/api/v1/shares/entity/folder/${folder.id}/public-access`,
      {
        method: 'PATCH',
        headers: bearerJson(ownerToken),
        body: JSON.stringify({ permission: 'private' }),
      },
    );
    expect(privateResponse.status).toBe(200);
    expect(await privateResponse.json()).toMatchObject({ permission: 'private' });
  });

  it('returns privacy-limited sharing details to users without management access', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const viewer = await createTestUser();
    const page = await createTestPage(owner.id, { title: 'Limited summary' });
    const ownerToken = await createToken(app, owner.id, ['pages:write']);
    const viewerToken = await createToken(app, viewer.id, ['pages:write']);

    const grant = await app.request(`/api/v1/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: bearerJson(ownerToken),
      body: JSON.stringify({ email: viewer.email, permission: 'view' }),
    });
    expect(grant.status).toBe(200);

    const response = await app.request(`/api/v1/shares/entity/page/${page.id}`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(response.status).toBe(200);
    const limitedSummary = (await response.json()) as Record<string, unknown>;
    expect(limitedSummary).toMatchObject({
      visibility: 'limited',
      entity: { id: page.id, ownerId: null },
      grants: [],
      pendingInvitations: [],
      accessSources: [],
    });
    expect(limitedSummary).not.toHaveProperty('inheritance');

    const deniedMutation = await app.request(
      `/api/v1/shares/entity/page/${page.id}/public-access`,
      {
        method: 'PATCH',
        headers: bearerJson(viewerToken),
        body: JSON.stringify({ permission: 'edit' }),
      },
    );
    expect(deniedMutation.status).toBe(403);
  });

  it('enforces read and write token scopes', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const page = await createTestPage(owner.id);
    const readToken = await createToken(app, owner.id, ['pages:read']);

    const readResponse = await app.request(`/api/v1/shares/entity/page/${page.id}`, {
      headers: { Authorization: `Bearer ${readToken}` },
    });
    expect(readResponse.status).toBe(200);

    const mutationResponse = await app.request(
      `/api/v1/shares/entity/page/${page.id}/inheritance`,
      {
        method: 'PATCH',
        headers: bearerJson(readToken),
        body: JSON.stringify({ policy: 'restricted' }),
      },
    );
    expect(mutationResponse.status).toBe(403);
    expect(await mutationResponse.json()).toMatchObject({
      error: { code: 'insufficient_scope', message: 'Token requires pages:write' },
    });
  });
});
