import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../test-utils';

const jsonHeaders = (cookie: string) => ({
  Cookie: cookie,
  'Content-Type': 'application/json',
});

const publicWebUrl = (pathname: string) =>
  `${(process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/+$/, '')}${pathname}`;

async function setPublicAccess(
  app: Awaited<ReturnType<typeof createTestApp>>,
  cookie: string,
  entityType: 'page' | 'folder',
  entityId: string,
  permission: 'private' | 'view' | 'edit',
) {
  return app.request(`/api/shares/entity/${entityType}/${entityId}/public-access`, {
    method: 'PATCH',
    headers: jsonHeaders(cookie),
    body: JSON.stringify({ permission }),
  });
}

describe('sharing API', () => {
  it('requires authentication for sharing management', async () => {
    const app = await createTestApp();
    const pageId = crypto.randomUUID();

    expect((await app.request(`/api/shares/entity/page/${pageId}`)).status).toBe(401);
    expect(
      (
        await app.request(`/api/shares/entity/page/${pageId}/public-access`, {
          method: 'PATCH',
        })
      ).status,
    ).toBe(401);
  });

  it.each([
    ['PATCH', (id: string) => `/api/shares/entity/page/${id}/inheritance`],
    ['PATCH', (id: string) => `/api/shares/entity/page/${id}/public-access`],
    ['POST', (id: string) => `/api/shares/entity/page/${id}/grants`],
    ['PATCH', (id: string) => `/api/shares/grants/${id}`],
  ] as const)('returns 400 for malformed JSON on %s sharing requests', async (method, path) => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const response = await app.request(path(crypto.randomUUID()), {
      method,
      headers: jsonHeaders(session.Cookie),
      body: '{',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Malformed JSON body' });
  });

  it('creates permanent grants for existing accounts without delivery claims', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ email: 'grant-owner@example.com' });
    const recipient = await createTestUser({ email: 'grant-recipient@example.com' });
    const ownerSession = await createTestSession(owner.id);
    const recipientSession = await createTestSession(recipient.id);
    const page = await createTestPage(owner.id, { title: 'Grant target' });

    const grantResponse = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: recipient.email, permission: 'edit' }),
    });

    expect(grantResponse.status).toBe(200);
    const grantBody = (await grantResponse.json()) as { message: string };
    expect(grantBody.message).toContain('Granted Editor access');
    expect(grantBody.message.toLowerCase()).not.toContain('email');
    expect(grantBody.message.toLowerCase()).not.toContain('invitation sent');

    const stored = await query<{
      id: string;
      recipient_user_id: string;
      permission: string;
    }>(
      `select id, recipient_user_id, permission
       from shares where entity_type = 'page' and entity_id = $1`,
      [page.id],
    );
    expect(stored.rows).toEqual([
      expect.objectContaining({ recipient_user_id: recipient.id, permission: 'edit' }),
    ]);

    const pageResponse = await app.request(`/api/pages/${page.id}`, {
      headers: { Cookie: recipientSession.Cookie },
    });
    expect(pageResponse.status).toBe(200);

    const summaryResponse = await app.request(`/api/shares/entity/page/${page.id}`, {
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(summaryResponse.status).toBe(200);
    const summary = (await summaryResponse.json()) as {
      publicAccess: { permission: string; url: string };
      grants: Array<{ id: string; recipientUserId: string; permission: string }>;
    };
    expect(summary.publicAccess).toEqual({
      permission: 'private',
      url: publicWebUrl(`/grant-target-${page.id}`),
    });
    expect(summary.grants).toEqual([
      expect.objectContaining({ recipientUserId: recipient.id, permission: 'edit' }),
    ]);
  });

  it('creates pending invitations for unknown email addresses', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const page = await createTestPage(owner.id);

    const response = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: 'missing-user@example.com', permission: 'view' }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        ok: true,
        message: 'Invitation queued for missing-user@example.com',
        invitation: expect.objectContaining({ deliveryStatus: 'pending' }),
      }),
    );
    const count = await query<{ count: string }>(
      'select count(*)::text as count from shares where entity_id = $1',
      [page.id],
    );
    expect(count.rows[0]?.count).toBe('0');
    const invitations = await query<{ count: string }>(
      'select count(*)::text as count from pending_invitations where target_type = $1 and target_id = $2 and email = $3',
      ['page', page.id, 'missing-user@example.com'],
    );
    expect(invitations.rows[0]?.count).toBe('1');
  });

  it('revokes pending invitations when their sender loses Admin access', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ email: 'owner@example.com' });
    const admin = await createTestUser({ email: 'admin@example.com' });
    const ownerSession = await createTestSession(owner.id);
    const adminSession = await createTestSession(admin.id);
    const page = await createTestPage(owner.id, { title: 'Managed page' });
    const grantResponse = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: admin.email, permission: 'admin' }),
    });
    expect(grantResponse.status).toBe(200);
    const grant = await query<{ id: string }>(
      `select id from shares where entity_type = 'page' and entity_id = $1
       and recipient_user_id = $2`,
      [page.id, admin.id],
    );
    const grantId = grant.rows[0]?.id;
    if (!grantId) throw new Error('Admin grant fixture did not return an ID');

    const invitationResponse = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(adminSession.Cookie),
      body: JSON.stringify({ email: 'admin-invite@example.com', permission: 'edit' }),
    });
    expect(invitationResponse.status).toBe(202);

    const demotion = await app.request(`/api/shares/grants/${grantId}`, {
      method: 'PATCH',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ permission: 'edit' }),
    });
    expect(demotion.status).toBe(200);
    const invitation = await query<{ id: string; status: string }>(
      `select id, status from pending_invitations
       where target_type = 'page' and target_id = $1 and invited_by = $2`,
      [page.id, admin.id],
    );
    expect(invitation.rows[0]?.status).toBe('revoked');
    const invitationId = invitation.rows[0]?.id;
    if (!invitationId) throw new Error('Invitation fixture did not return an ID');
    const summary = await app.request(`/api/shares/entity/page/${page.id}`, {
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ pendingInvitations: [] });
    const retainedInvitation = await query<{ status: string }>(
      'select status from pending_invitations where id = $1',
      [invitationId],
    );
    expect(retainedInvitation.rows[0]?.status).toBe('revoked');
  });

  it.each([
    'page',
    'folder',
  ] as const)('protects owner-only Admin invitations from replacement on a %s', async (entityType) => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const admin = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const adminSession = await createTestSession(admin.id);
    const entity =
      entityType === 'page' ? await createTestPage(owner.id) : await createTestFolder(owner.id);
    const path = `/api/shares/entity/${entityType}/${entity.id}/grants`;
    expect(
      (
        await app.request(path, {
          method: 'POST',
          headers: jsonHeaders(ownerSession.Cookie),
          body: JSON.stringify({ email: admin.email, permission: 'admin' }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(path, {
          method: 'POST',
          headers: jsonHeaders(ownerSession.Cookie),
          body: JSON.stringify({ email: 'protected-invite@example.com', permission: 'admin' }),
        })
      ).status,
    ).toBe(202);

    const before = await query<{
      id: string;
      token_hash: string;
      invited_by: string;
      permission: string;
    }>(
      'select id, token_hash, invited_by, permission from pending_invitations where target_id = $1',
      [entity.id],
    );
    await query(
      `update invitation_send_attempts set attempted_at = now() - interval '20 minutes'
         where invitation_id = $1`,
      [before.rows[0]?.id],
    );

    const replacement = await app.request(path, {
      method: 'POST',
      headers: jsonHeaders(adminSession.Cookie),
      body: JSON.stringify({ email: 'protected-invite@example.com', permission: 'edit' }),
    });
    expect(replacement.status).toBe(403);
    expect(await replacement.json()).toEqual({
      message: 'Only the Owner can manage Admin invitations',
    });
    const after = await query(
      'select id, token_hash, invited_by, permission from pending_invitations where target_id = $1',
      [entity.id],
    );
    expect(after.rows).toEqual(before.rows);

    // The same replacement remains available to the owner.
    expect(
      (
        await app.request(path, {
          method: 'POST',
          headers: jsonHeaders(ownerSession.Cookie),
          body: JSON.stringify({ email: 'protected-invite@example.com', permission: 'edit' }),
        })
      ).status,
    ).toBe(202);
  });

  it('marks Owner-only Admin invitations as unmanageable for Admin viewers', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ email: 'capability-owner@example.com' });
    const admin = await createTestUser({ email: 'capability-admin@example.com' });
    const ownerSession = await createTestSession(owner.id);
    const adminSession = await createTestSession(admin.id);
    const page = await createTestPage(owner.id, { title: 'Capability page' });
    const adminGrant = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: admin.email, permission: 'admin' }),
    });
    expect(adminGrant.status).toBe(200);
    const invitation = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: 'future-admin@example.com', permission: 'admin' }),
    });
    expect(invitation.status).toBe(202);

    const adminSummary = await app.request(`/api/shares/entity/page/${page.id}`, {
      headers: { Cookie: adminSession.Cookie },
    });
    expect(await adminSummary.json()).toMatchObject({
      pendingInvitations: [expect.objectContaining({ canManage: false })],
    });
    const ownerSummary = await app.request(`/api/shares/entity/page/${page.id}`, {
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(await ownerSummary.json()).toMatchObject({
      pendingInvitations: [expect.objectContaining({ canManage: true })],
    });
  });

  it('updates and revokes direct grants under the entity access lock', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const recipientSession = await createTestSession(recipient.id);
    const page = await createTestPage(owner.id);

    const grantResponse = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: recipient.email, permission: 'commenter' }),
    });
    expect(await grantResponse.json()).toEqual({
      ok: true,
      message: `Granted Commenter access to ${recipient.email} on ${page.title}`,
    });
    const grant = await query<{ id: string }>(
      'select id from shares where entity_type = $1 and entity_id = $2 and recipient_user_id = $3',
      ['page', page.id, recipient.id],
    );
    const grantId = grant.rows[0]?.id;
    if (!grantId) throw new Error('Expected grant');

    const updateResponse = await app.request(`/api/shares/grants/${grantId}`, {
      method: 'PATCH',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ permission: 'edit' }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toEqual({
      ok: true,
      message: `Updated ${recipient.email}’s access to edit on ${page.title}`,
    });
    expect(
      (
        await query<{ permission: string }>('select permission from shares where id = $1', [
          grantId,
        ])
      ).rows[0]?.permission,
    ).toBe('edit');

    const deleteResponse = await app.request(`/api/shares/grants/${grantId}`, {
      method: 'DELETE',
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({
      ok: true,
      message: `Removed ${recipient.email}’s access to ${page.title}`,
    });
    expect(
      (
        await app.request(`/api/pages/${page.id}`, {
          headers: { Cookie: recipientSession.Cookie },
        })
      ).status,
    ).toBe(403);
  });

  it('allows recipients to leave their own direct grant', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const recipientSession = await createTestSession(recipient.id);
    const page = await createTestPage(owner.id);

    await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: recipient.email, permission: 'view' }),
    });
    const grant = await query<{ id: string }>(
      'select id from shares where entity_id = $1 and recipient_user_id = $2',
      [page.id, recipient.id],
    );
    const grantId = grant.rows[0]?.id;
    if (!grantId) throw new Error('Expected grant');

    const response = await app.request(`/api/shares/grants/${grantId}`, {
      method: 'DELETE',
      headers: { Cookie: recipientSession.Cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: `Removed ${page.title} from your view`,
    });
  });

  it('keeps canonical page URLs stable through public access changes', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const page = await createTestPage(owner.id, { title: 'Stable Address' });
    const expectedUrl = publicWebUrl(`/stable-address-${page.id}`);

    expect((await app.request(`/api/pages/${page.id}`)).status).toBe(401);

    const enableView = await setPublicAccess(app, ownerSession.Cookie, 'page', page.id, 'view');
    expect(enableView.status).toBe(200);
    expect(await enableView.json()).toEqual(
      expect.objectContaining({ permission: 'view', url: expectedUrl }),
    );
    expect((await app.request(`/api/pages/${page.id}`)).status).toBe(200);

    const disable = await setPublicAccess(app, ownerSession.Cookie, 'page', page.id, 'private');
    expect(disable.status).toBe(200);
    expect(await disable.json()).toEqual(
      expect.objectContaining({ permission: 'private', url: expectedUrl }),
    );
    expect((await app.request(`/api/pages/${page.id}`)).status).toBe(401);

    const enableEdit = await setPublicAccess(app, ownerSession.Cookie, 'page', page.id, 'edit');
    expect(enableEdit.status).toBe(200);
    expect(await enableEdit.json()).toEqual(
      expect.objectContaining({ permission: 'edit', url: expectedUrl }),
    );
  });

  it('enforces public View and Edit on canonical page endpoints', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const page = await createTestPage(owner.id, { title: 'Public permissions' });
    const guestId = crypto.randomUUID();
    const guestHeaders = {
      Cookie: `metakip_anon_id=${guestId}`,
      'Content-Type': 'application/json',
    };

    await setPublicAccess(app, ownerSession.Cookie, 'page', page.id, 'view');
    const viewResponse = await app.request(`/api/pages/${page.id}`);
    expect(viewResponse.status).toBe(200);
    expect(viewResponse.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');

    const deniedTitle = await app.request(`/api/pages/${page.id}/title`, {
      method: 'PATCH',
      headers: guestHeaders,
      body: JSON.stringify({ title: 'Denied' }),
    });
    expect(deniedTitle.status).toBe(403);

    await setPublicAccess(app, ownerSession.Cookie, 'page', page.id, 'edit');
    const editedTitle = await app.request(`/api/pages/${page.id}/title`, {
      method: 'PATCH',
      headers: guestHeaders,
      body: JSON.stringify({ title: 'Guest edited' }),
    });
    expect(editedTitle.status).toBe(200);

    const editedMetadata = await app.request(`/api/pages/${page.id}/metadata`, {
      method: 'PATCH',
      headers: guestHeaders,
      body: JSON.stringify({ icon: 'G', coverType: 'color', coverValue: 'blue' }),
    });
    expect(editedMetadata.status).toBe(403);
    expect(await editedMetadata.json()).toEqual({
      message: 'Guest editors cannot change page icons or covers',
    });

    const manageResponse = await app.request(`/api/shares/entity/page/${page.id}`, {
      headers: { Cookie: `metakip_anon_id=${guestId}` },
    });
    expect(manageResponse.status).toBe(401);
  });

  it('does not allow Editors to manage public access or grant Admin', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const editor = await createTestUser();
    const recipient = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const editorSession = await createTestSession(editor.id);
    const page = await createTestPage(owner.id);

    await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: editor.email, permission: 'edit' }),
    });

    const publicResponse = await setPublicAccess(
      app,
      editorSession.Cookie,
      'page',
      page.id,
      'view',
    );
    expect(publicResponse.status).toBe(403);

    const grantResponse = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(editorSession.Cookie),
      body: JSON.stringify({ email: recipient.email, permission: 'admin' }),
    });
    expect(grantResponse.status).toBe(403);
  });

  it('records signed-in public visits and removes them when access is revoked', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const visitor = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const visitorSession = await createTestSession(visitor.id);
    const page = await createTestPage(owner.id, { title: 'Visited publicly' });

    await setPublicAccess(app, ownerSession.Cookie, 'page', page.id, 'view');
    const visitResponse = await app.request(`/api/pages/${page.id}`, {
      headers: { Cookie: visitorSession.Cookie },
    });
    expect(visitResponse.status).toBe(200);

    const withMeResponse = await app.request('/api/shares/with-me', {
      headers: { Cookie: visitorSession.Cookie },
    });
    expect(withMeResponse.status).toBe(200);
    expect(await withMeResponse.json()).toEqual([
      expect.objectContaining({ entityId: page.id, source: 'public' }),
    ]);

    await setPublicAccess(app, ownerSession.Cookie, 'page', page.id, 'private');
    const afterRevoke = await app.request('/api/shares/with-me', {
      headers: { Cookie: visitorSession.Cookie },
    });
    expect(await afterRevoke.json()).toEqual([]);
    const visitCount = await query<{ count: string }>(
      'select count(*)::text as count from page_public_access_visits where page_id = $1',
      [page.id],
    );
    expect(visitCount.rows[0]?.count).toBe('0');

    await setPublicAccess(app, ownerSession.Cookie, 'page', page.id, 'view');
    const afterReenable = await app.request('/api/shares/with-me', {
      headers: { Cookie: visitorSession.Cookie },
    });
    expect(await afterReenable.json()).toEqual([]);
  });

  it('clears subtree visit history when folder public access is revoked', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const visitor = await createTestUser();
    const grantee = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const visitorSession = await createTestSession(visitor.id);
    const root = await createTestFolder(owner.id, { name: 'Public root' });
    const child = await createTestFolder(owner.id, {
      name: 'Independent public child',
      parentId: root.id,
    });
    const page = await createTestPage(owner.id, {
      parentId: child.id,
      title: 'Independent public page',
    });
    await query("update folders set public_permission = 'view' where id = any($1::uuid[])", [
      [root.id, child.id],
    ]);
    await query("update pages set public_permission = 'view' where id = $1", [page.id]);
    await query(
      `insert into folder_public_access_visits (folder_id, user_id)
       values ($1, $3), ($2, $3)`,
      [root.id, child.id, visitor.id],
    );
    await query('insert into page_public_access_visits (page_id, user_id) values ($1, $2)', [
      page.id,
      visitor.id,
    ]);
    await query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'view')`,
      [page.id, owner.id, grantee.id],
    );

    const revoke = await setPublicAccess(app, ownerSession.Cookie, 'folder', root.id, 'private');
    expect(revoke.status).toBe(200);

    const visits = await query<{ count: string }>(
      `select (
         (select count(*) from folder_public_access_visits
          where folder_id = any($1::uuid[]) and user_id = $3) +
         (select count(*) from page_public_access_visits
          where page_id = $2 and user_id = $3)
       )::text as count`,
      [[root.id, child.id], page.id, visitor.id],
    );
    expect(visits.rows[0]?.count).toBe('0');

    const grant = await query<{ count: string }>(
      `select count(*)::text as count from shares
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, grantee.id],
    );
    expect(grant.rows[0]?.count).toBe('1');

    const afterRevoke = await app.request('/api/shares/with-me', {
      headers: { Cookie: visitorSession.Cookie },
    });
    expect(afterRevoke.status).toBe(200);
    expect(await afterRevoke.json()).toEqual([]);

    const revisit = await app.request(`/api/pages/${page.id}`, {
      headers: { Cookie: visitorSession.Cookie },
    });
    expect(revisit.status).toBe(200);
    const afterDirectVisit = await app.request('/api/shares/with-me', {
      headers: { Cookie: visitorSession.Cookie },
    });
    expect(await afterDirectVisit.json()).toEqual([
      expect.objectContaining({ entityId: page.id, source: 'public' }),
    ]);
  });

  it('deduplicates nested grants until a restricted boundary makes the child independent', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const recipientSession = await createTestSession(recipient.id);
    const folder = await createTestFolder(owner.id, { name: 'Granted root' });
    const page = await createTestPage(owner.id, {
      parentId: folder.id,
      title: 'Direct child grant',
    });

    for (const [entityType, entityId] of [
      ['folder', folder.id],
      ['page', page.id],
    ] as const) {
      const response = await app.request(`/api/shares/entity/${entityType}/${entityId}/grants`, {
        method: 'POST',
        headers: jsonHeaders(ownerSession.Cookie),
        body: JSON.stringify({ email: recipient.email, permission: 'view' }),
      });
      expect(response.status).toBe(200);
    }

    const nestedRoots = await app.request('/api/shares/with-me', {
      headers: { Cookie: recipientSession.Cookie },
    });
    expect(nestedRoots.status).toBe(200);
    expect(await nestedRoots.json()).toEqual([
      expect.objectContaining({ entityType: 'folder', entityId: folder.id }),
    ]);

    const restrict = await app.request(`/api/shares/entity/page/${page.id}/inheritance`, {
      method: 'PATCH',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ policy: 'restricted' }),
    });
    expect(restrict.status).toBe(200);

    const independentRoots = await app.request('/api/shares/with-me', {
      headers: { Cookie: recipientSession.Cookie },
    });
    expect(independentRoots.status).toBe(200);
    const independentItems = (await independentRoots.json()) as Array<{
      entityType: 'folder' | 'page';
      entityId: string;
    }>;
    expect(new Set(independentItems.map((item) => `${item.entityType}:${item.entityId}`))).toEqual(
      new Set([`folder:${folder.id}`, `page:${page.id}`]),
    );
  });

  it('builds a consistent Shared With Me tree from a folder grant', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const recipientSession = await createTestSession(recipient.id);
    const root = await createTestFolder(owner.id, { name: 'Shared tree root' });
    const childFolder = await createTestFolder(owner.id, {
      name: 'Nested folder',
      parentId: root.id,
    });
    const rootPage = await createTestPage(owner.id, {
      parentId: root.id,
      title: 'Root page',
    });
    const nestedPage = await createTestPage(owner.id, {
      parentId: childFolder.id,
      title: 'Nested page',
    });

    const grant = await app.request(`/api/shares/entity/folder/${root.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: recipient.email, permission: 'view' }),
    });
    expect(grant.status).toBe(200);

    const response = await app.request('/api/shares/with-me/tree', {
      headers: { Cookie: recipientSession.Cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        entityType: 'folder',
        id: root.id,
        parentId: null,
        source: 'direct',
        children: expect.arrayContaining([
          expect.objectContaining({ entityType: 'page', id: rootPage.id }),
          expect.objectContaining({
            entityType: 'folder',
            id: childFolder.id,
            children: [expect.objectContaining({ entityType: 'page', id: nestedPage.id })],
          }),
        ]),
      }),
    ]);
  });

  it('inherits folder public access and honors restricted descendants', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const folder = await createTestFolder(owner.id, { name: 'Public folder' });
    const childFolder = await createTestFolder(owner.id, {
      name: 'Restricted child',
      parentId: folder.id,
    });
    const visiblePage = await createTestPage(owner.id, { parentId: folder.id });
    const blockedPage = await createTestPage(owner.id, { parentId: childFolder.id });

    await setPublicAccess(app, ownerSession.Cookie, 'folder', folder.id, 'view');
    expect((await app.request(`/api/folders/${folder.id}`)).status).toBe(200);
    expect((await app.request(`/api/pages/${visiblePage.id}`)).status).toBe(200);
    expect((await app.request(`/api/pages/${blockedPage.id}`)).status).toBe(200);

    const restrictResponse = await app.request(
      `/api/shares/entity/folder/${childFolder.id}/inheritance`,
      {
        method: 'PATCH',
        headers: jsonHeaders(ownerSession.Cookie),
        body: JSON.stringify({ policy: 'restricted' }),
      },
    );
    expect(restrictResponse.status).toBe(200);
    expect((await app.request(`/api/folders/${childFolder.id}`)).status).toBe(401);
    expect((await app.request(`/api/pages/${blockedPage.id}`)).status).toBe(401);
  });

  it('inherits permanent account grants from folders and blocks them at restrictions', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const recipientSession = await createTestSession(recipient.id);
    const folder = await createTestFolder(owner.id);
    const child = await createTestFolder(owner.id, { parentId: folder.id });
    const page = await createTestPage(owner.id, { parentId: child.id });

    await app.request(`/api/shares/entity/folder/${folder.id}/grants`, {
      method: 'POST',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ email: recipient.email, permission: 'edit' }),
    });
    expect(
      (
        await app.request(`/api/pages/${page.id}`, {
          headers: { Cookie: recipientSession.Cookie },
        })
      ).status,
    ).toBe(200);

    await app.request(`/api/shares/entity/folder/${child.id}/inheritance`, {
      method: 'PATCH',
      headers: jsonHeaders(ownerSession.Cookie),
      body: JSON.stringify({ policy: 'restricted' }),
    });
    expect(
      (
        await app.request(`/api/pages/${page.id}`, {
          headers: { Cookie: recipientSession.Cookie },
        })
      ).status,
    ).toBe(403);
  });

  it('reports inherited public access without exposing authority tokens', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const ownerSession = await createTestSession(owner.id);
    const folder = await createTestFolder(owner.id, { name: 'Public ancestor' });
    const page = await createTestPage(owner.id, { parentId: folder.id });

    await setPublicAccess(app, ownerSession.Cookie, 'folder', folder.id, 'edit');
    const response = await app.request(`/api/shares/entity/page/${page.id}`, {
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown> & {
      inheritedPublicAccess: Array<Record<string, unknown>>;
    };
    expect(body.inheritedPublicAccess).toEqual([
      {
        entityId: folder.id,
        entityTitle: folder.name,
        permission: 'edit',
        url: publicWebUrl(`/folder/public-ancestor-${folder.id}`),
      },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/token|expires/i);
  });

  it('returns explicit restricted, forbidden, and missing outcomes', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const strangerSession = await createTestSession(stranger.id);
    const page = await createTestPage(owner.id);

    expect((await app.request(`/api/pages/${page.id}`)).status).toBe(401);
    expect(
      (
        await app.request(`/api/pages/${page.id}`, {
          headers: { Cookie: strangerSession.Cookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request('/api/pages/00000000-0000-0000-0000-000000000000', {
          headers: { Cookie: strangerSession.Cookie },
        })
      ).status,
    ).toBe(404);
  });
});
