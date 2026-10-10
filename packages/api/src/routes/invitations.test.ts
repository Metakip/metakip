import { createHash } from 'node:crypto';
import { buildPagePath } from '@metakip/shared';
import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import { createTestApp, createTestPage, createTestSession, createTestUser } from '../test-utils';
import { acceptInvitation } from '../utils/invitationClaims';
import { WELCOME_PAGE_TITLE } from '../utils/welcomePage';

const TOKEN = 'a'.repeat(43);
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

describe('invitation API', () => {
  it('returns 401 when accepting without a session', async () => {
    const app = await createTestApp();
    const response = await app.request(`/api/invitations/claim/${TOKEN}`, { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it.each([
    ['POST', '/api/invitations/not-a-uuid/resend'],
    ['DELETE', '/api/invitations/not-a-uuid'],
  ] as const)('rejects malformed invitation IDs on %s', async (method, path) => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);

    const response = await app.request(path, {
      method,
      headers: { Cookie: session.Cookie },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Invalid invitation ID' });
  });

  it('does not advance access revisions for invitation-only writes and reads', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Revision Owner' });
    const page = await createTestPage(owner.id, { title: 'Revision page' });
    const session = await createTestSession(owner.id);
    const before = await query<{ version: string }>(
      'select version::text as version from workspace_access_versions where workspace_owner_id = $1',
      [owner.id],
    );

    const creation = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'revision-invite@example.com', permission: 'view' }),
    });
    expect(creation.status).toBe(202);
    const afterCreation = await query<{ version: string }>(
      'select version::text as version from workspace_access_versions where workspace_owner_id = $1',
      [owner.id],
    );

    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, 'revision-claim@example.com', 'view', $2, $3,
               now() + interval '7 days')`,
      [page.id, owner.id, TOKEN_HASH],
    );
    const claim = await app.request(`/api/invitations/claim/${TOKEN}`);
    expect(claim.status).toBe(200);
    const afterClaim = await query<{ version: string }>(
      'select version::text as version from workspace_access_versions where workspace_owner_id = $1',
      [owner.id],
    );

    expect(afterCreation.rows[0]?.version).toBe(before.rows[0]?.version);
    expect(afterClaim.rows[0]?.version).toBe(before.rows[0]?.version);
  });

  it('creates a commenter invitation for a new recipient', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const page = await createTestPage(owner.id, { title: 'Commenter invitation page' });
    const session = await createTestSession(owner.id);

    const response = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'commenter-invite@example.com', permission: 'commenter' }),
    });

    expect(response.status).toBe(202);
    const invitation = await query<{ permission: string }>(
      `select permission from pending_invitations
       where target_id = $1 and email = $2`,
      [page.id, 'commenter-invite@example.com'],
    );
    expect(invitation.rows[0]?.permission).toBe('commenter');
  });

  it('lets a logged-out recipient decline a pending invitation', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const page = await createTestPage(owner.id, { title: 'Declined page' });
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, 'invitee@example.com', 'view', $2, $3,
               now() + interval '7 days')`,
      [page.id, owner.id, TOKEN_HASH],
    );

    const response = await app.request(`/api/invitations/claim/${TOKEN}/decline`, {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const claim = await app.request(`/api/invitations/claim/${TOKEN}`);
    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({ status: 'declined' });
  });

  it('presents a revoked invitation when its page is soft-deleted', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Deleted Target Owner' });
    const page = await createTestPage(owner.id, { title: 'Removed page' });
    const token = 'b'.repeat(43);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invitation = await query<{ id: string }>(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, 'deleted-target@example.com', 'view', $2, $3,
               now() + interval '7 days')
       returning id`,
      [page.id, owner.id, tokenHash],
    );
    const invitationId = invitation.rows[0]?.id;
    if (!invitationId) throw new Error('Invitation fixture did not return an ID');
    await query('update pages set is_deleted = true where id = $1', [page.id]);
    await query(
      `update pending_invitations
       set status = 'revoked', resolved_at = now(), updated_at = now()
       where id = $1`,
      [invitationId],
    );

    const claim = await app.request(`/api/invitations/claim/${token}`);

    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({
      status: 'revoked',
      targetTitle: 'Unavailable page',
    });
  });

  it('rejects contradictory invitation lifecycle states at the database boundary', async () => {
    const owner = await createTestUser({ name: 'Lifecycle Owner' });

    await expect(
      query(
        `insert into pending_invitations
           (target_type, target_id, email, permission, invited_by, token_hash,
            expires_at, status)
         values ('workspace', $1, 'invalid@example.com', 'viewer', $1, $2,
                 now() + interval '7 days', 'declined')`,
        [owner.id, TOKEN_HASH],
      ),
    ).rejects.toThrow(/pending_invitations_resolution_check/);

    await expect(
      query(
        `insert into pending_invitations
           (target_type, target_id, email, permission, invited_by, token_hash,
            expires_at, status, resolved_at)
         values ('workspace', $1, 'invalid-accepted@example.com', 'viewer', $1, $2,
                 now() + interval '7 days', 'accepted', now())`,
        [owner.id, createHash('sha256').update('invalid-accepted').digest('hex')],
      ),
    ).rejects.toThrow(/pending_invitations_resolution_check/);
  });

  it('allows an account to be deleted after it accepted an invitation', async () => {
    const owner = await createTestUser({ name: 'Deletion Owner' });
    const recipient = await createTestUser({ name: 'Deleting Recipient' });
    const invitation = await query<{ id: string }>(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash,
          expires_at, status, resolved_at, accepted_by)
       values ('workspace', $1, $2, 'viewer', $1, $3,
               now() + interval '7 days', 'accepted', now(), $4)
       returning id`,
      [
        owner.id,
        recipient.email,
        createHash('sha256').update('deleted-recipient').digest('hex'),
        recipient.id,
      ],
    );

    await expect(query('delete from users where id = $1', [recipient.id])).resolves.toMatchObject({
      rowCount: 1,
    });
    const retained = await query('select id from pending_invitations where id = $1', [
      invitation.rows[0]?.id,
    ]);
    expect(retained.rowCount).toBe(0);
  });

  it('authorizes resend against the exact invitation target', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const intruder = await createTestUser({ name: 'Intruder' });
    const page = await createTestPage(owner.id, { title: 'Private page' });
    const session = await createTestSession(intruder.id);
    const invitation = await query<{ id: string }>(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, 'invitee@example.com', 'view', $2, $3,
               now() + interval '7 days')
       returning id`,
      [page.id, owner.id, TOKEN_HASH],
    );
    const invitationId = invitation.rows[0]?.id;
    if (!invitationId) throw new Error('Invitation fixture did not return an ID');

    const response = await app.request(`/api/invitations/${invitationId}/resend`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(response.status).toBe(403);
  });

  it('claim reads do not mutate invalid invitations, while commands persist revocation', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const admin = await createTestUser({ name: 'Former Admin' });
    const recipient = await createTestUser({ email: 'stale-invite@example.com' });
    const page = await createTestPage(owner.id, { title: 'Authority page' });
    const ownerSession = await createTestSession(owner.id);
    const recipientSession = await createTestSession(recipient.id);
    await query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'admin')`,
      [page.id, owner.id, admin.id],
    );
    const invitation = await query<{ id: string }>(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, $2, 'edit', $3, $4, now() + interval '7 days')
       returning id`,
      [page.id, recipient.email, admin.id, TOKEN_HASH],
    );
    const invitationId = invitation.rows[0]?.id;
    if (!invitationId) throw new Error('Invitation fixture did not return an ID');
    await query(
      `update shares set permission = 'edit'
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, admin.id],
    );

    const claim = await app.request(`/api/invitations/claim/${TOKEN}`);
    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({ status: 'revoked' });
    const persisted = await query<{ status: string }>(
      'select status from pending_invitations where id = $1',
      [invitationId],
    );
    expect(persisted.rows[0]?.status).toBe('pending');
    const acceptance = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: recipientSession.Cookie },
    });
    expect(acceptance.status).toBe(410);
    const resend = await app.request(`/api/invitations/${invitationId}/resend`, {
      method: 'POST',
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(resend.status).toBe(409);
    const summary = await app.request(`/api/shares/entity/page/${page.id}`, {
      headers: { Cookie: ownerSession.Cookie },
    });
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ pendingInvitations: [] });

    await query(
      `update shares set permission = 'admin'
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, admin.id],
    );
    const restoredAuthorityClaim = await app.request(`/api/invitations/claim/${TOKEN}`);
    expect(await restoredAuthorityClaim.json()).toMatchObject({ status: 'revoked' });
  });

  it('permanently revokes lost inviter authority during direct acceptance', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const admin = await createTestUser({ name: 'Former Admin' });
    const recipient = await createTestUser({ email: 'direct-stale-invite@example.com' });
    const page = await createTestPage(owner.id, { title: 'Direct stale authority page' });
    const recipientSession = await createTestSession(recipient.id);
    await query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'admin')`,
      [page.id, owner.id, admin.id],
    );
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, $2, 'edit', $3, $4, now() + interval '7 days')`,
      [page.id, recipient.email, admin.id, TOKEN_HASH],
    );
    await query(
      `update shares set permission = 'edit'
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, admin.id],
    );

    const rejected = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: recipientSession.Cookie },
    });

    expect(rejected.status).toBe(410);
    const revoked = await query<{ status: string }>(
      'select status from pending_invitations where token_hash = $1',
      [TOKEN_HASH],
    );
    expect(revoked.rows[0]?.status).toBe('revoked');

    await query(
      `update shares set permission = 'admin'
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, admin.id],
    );
    const repeated = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: recipientSession.Cookie },
    });
    expect(repeated.status).toBe(410);
  });

  it.each([
    ['POST', '/resend'],
    ['DELETE', ''],
  ] as const)('commits lost-authority revocation before rejecting %s %s', async (method, suffix) => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const formerAdmin = await createTestUser();
    const page = await createTestPage(owner.id);
    const session = await createTestSession(owner.id);
    const invitation = await query<{ id: string }>(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, 'former-admin-invite@example.com', 'view', $2, $3,
               now() + interval '7 days') returning id`,
      [page.id, formerAdmin.id, TOKEN_HASH],
    );
    const invitationId = invitation.rows[0]?.id;
    if (!invitationId) throw new Error('Invitation fixture did not return an ID');

    const response = await app.request(`/api/invitations/${invitationId}${suffix}`, {
      method,
      headers: { Cookie: session.Cookie },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ message: 'Invitation is revoked' });
    const persisted = await query<{ status: string }>(
      'select status from pending_invitations where id = $1',
      [invitationId],
    );
    expect(persisted.rows[0]?.status).toBe('revoked');

    await query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'admin')`,
      [page.id, owner.id, formerAdmin.id],
    );
    const claim = await app.request(`/api/invitations/claim/${TOKEN}`);
    expect(await claim.json()).toMatchObject({ status: 'revoked' });
  });

  it('returns a structured code when the signed-in email does not match', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Workspace Owner' });
    const recipient = await createTestUser({ email: 'different@example.com' });
    const session = await createTestSession(recipient.id);
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('workspace', $1, 'invited@example.com', 'viewer', $1, $2,
               now() + interval '7 days')`,
      [owner.id, TOKEN_HASH],
    );

    const response = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'INVITATION_EMAIL_MISMATCH',
      message: 'Sign in with the invited email address to accept this invitation',
    });
  });

  it('accepts a workspace invitation, provisions welcome content, and skips onboarding', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Workspace Owner' });
    const recipient = await createTestUser({ email: 'invitee@example.com' });
    const session = await createTestSession(recipient.id);
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('workspace', $1, $2, 'viewer', $1, $3, now() + interval '7 days')`,
      [owner.id, recipient.email, TOKEN_HASH],
    );

    const response = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, destination: '/' });
    const membership = await query(
      'select id from workspace_members where workspace_owner_id = $1 and member_id = $2',
      [owner.id, recipient.id],
    );
    expect(membership.rowCount).toBe(1);
    const user = await query<{
      account_setup_completed_at: Date | null;
      onboarding_completed_at: Date | null;
    }>('select account_setup_completed_at, onboarding_completed_at from users where id = $1', [
      recipient.id,
    ]);
    expect(user.rows[0]?.onboarding_completed_at).not.toBeNull();
    expect(user.rows[0]?.account_setup_completed_at).not.toBeNull();
    const welcome = await query<{ favorite: boolean }>(
      `select exists (
         select 1 from user_favorites favorite
         where favorite.user_id = $1 and favorite.entity_type = 'page'
           and favorite.entity_id = page.id
       ) as favorite
       from pages page
       where page.created_by = $1 and page.title = $2 and page.is_deleted = false`,
      [recipient.id, WELCOME_PAGE_TITLE],
    );
    expect(welcome.rows).toEqual([{ favorite: true }]);

    await query(
      `update pages set title = 'My renamed welcome page'
       where created_by = $1 and title = $2`,
      [recipient.id, WELCOME_PAGE_TITLE],
    );
    const repeated = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });
    expect(repeated.status).toBe(200);
    const pages = await query<{ count: string }>(
      'select count(*)::text as count from pages where created_by = $1 and is_deleted = false',
      [recipient.id],
    );
    expect(pages.rows[0]?.count).toBe('1');
  });

  it('redirects an accepted page invitation to the shared page', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const recipient = await createTestUser({ email: 'page-invitee@example.com' });
    const page = await createTestPage(owner.id, { title: 'Invited page' });
    const session = await createTestSession(recipient.id);
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, $2, 'edit', $3, $4, now() + interval '7 days')`,
      [page.id, recipient.email, owner.id, TOKEN_HASH],
    );

    const response = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      destination: buildPagePath(page.title, page.id),
    });
    const grant = await query<{ permission: string }>(
      `select permission from shares
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, recipient.id],
    );
    expect(grant.rows).toEqual([{ permission: 'edit' }]);
  });

  it('keeps accepted access when optional welcome setup fails and retries it later', async () => {
    const owner = await createTestUser({ name: 'Workspace Owner' });
    const recipient = await createTestUser({ email: 'setup-failure@example.com' });
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('workspace', $1, $2, 'viewer', $1, $3, now() + interval '7 days')`,
      [owner.id, recipient.email, TOKEN_HASH],
    );

    await createTestApp();
    let committedMemberCount: number | null = null;
    await expect(
      acceptInvitation(TOKEN, recipient.id, async (_tx, userId) => {
        // The accepted grant must already be visible from another connection.
        const committed = await query(
          'select id from workspace_members where workspace_owner_id = $1 and member_id = $2',
          [owner.id, userId],
        );
        committedMemberCount = committed.rowCount;
        throw new Error('Forced account setup failure');
      }),
    ).resolves.toBe('/');
    expect(committedMemberCount).toBe(1);

    const invitation = await query<{ status: string }>(
      'select status from pending_invitations where token_hash = $1',
      [TOKEN_HASH],
    );
    expect(invitation.rows[0]?.status).toBe('accepted');
    const membership = await query(
      'select id from workspace_members where workspace_owner_id = $1 and member_id = $2',
      [owner.id, recipient.id],
    );
    expect(membership.rowCount).toBe(1);
    const account = await query<{
      account_setup_completed_at: Date | null;
      onboarding_completed_at: Date | null;
    }>('select account_setup_completed_at, onboarding_completed_at from users where id = $1', [
      recipient.id,
    ]);
    expect(account.rows[0]?.account_setup_completed_at).toBeNull();
    expect(account.rows[0]?.onboarding_completed_at).not.toBeNull();

    await expect(acceptInvitation(TOKEN, recipient.id)).resolves.toBe('/');
    const welcome = await query('select id from pages where created_by = $1 and title = $2', [
      recipient.id,
      WELCOME_PAGE_TITLE,
    ]);
    expect(welcome.rowCount).toBe(1);
  });

  it('serializes invitation acceptance with a direct grant to the same recipient', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const recipient = await createTestUser({ email: 'race-invitee@example.com' });
    const page = await createTestPage(owner.id, { title: 'Concurrent page' });
    const ownerSession = await createTestSession(owner.id);
    const recipientSession = await createTestSession(recipient.id);
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, $2, 'edit', $3, $4, now() + interval '7 days')`,
      [page.id, recipient.email, owner.id, TOKEN_HASH],
    );

    const [acceptance, directGrant] = await Promise.all([
      app.request(`/api/invitations/claim/${TOKEN}`, {
        method: 'POST',
        headers: { Cookie: recipientSession.Cookie },
      }),
      app.request(`/api/shares/entity/page/${page.id}/grants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
        body: JSON.stringify({ email: recipient.email, permission: 'edit' }),
      }),
    ]);

    expect(acceptance.status).toBe(200);
    expect(directGrant.status).toBe(200);
    const grants = await query(
      `select id from shares
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, recipient.id],
    );
    expect(grants.rowCount).toBe(1);
  });

  it('supersedes a pending invitation when access is granted directly', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const page = await createTestPage(owner.id, { title: 'Direct access page' });
    const ownerSession = await createTestSession(owner.id);
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, 'later-account@example.com', 'view', $2, $3,
               now() + interval '7 days')`,
      [page.id, owner.id, TOKEN_HASH],
    );
    const recipient = await createTestUser({ email: 'later-account@example.com' });

    const response = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
      body: JSON.stringify({ email: recipient.email, permission: 'edit' }),
    });

    expect(response.status).toBe(200);
    const invitation = await query<{ status: string }>(
      'select status from pending_invitations where token_hash = $1',
      [TOKEN_HASH],
    );
    expect(invitation.rows[0]?.status).toBe('superseded');
    const claim = await app.request(`/api/invitations/claim/${TOKEN}`);
    expect(await claim.json()).toMatchObject({ status: 'superseded' });
  });

  it('rejects a superseded invitation when its replacement access was removed', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const recipient = await createTestUser({ email: 'removed-access@example.com' });
    const page = await createTestPage(owner.id, { title: 'Formerly shared page' });
    const session = await createTestSession(recipient.id);
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash,
          expires_at, status, resolved_at)
       values ('page', $1, $2, 'view', $3, $4,
               now() + interval '7 days', 'superseded', now())`,
      [page.id, recipient.email, owner.id, TOKEN_HASH],
    );

    const claim = await app.request(`/api/invitations/claim/${TOKEN}`);
    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({ status: 'revoked' });

    const response = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ message: 'Invitation was revoked' });
  });

  it('rejects a superseded workspace invitation after membership removal', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Workspace Owner' });
    const recipient = await createTestUser({ email: 'removed-member@example.com' });
    const session = await createTestSession(recipient.id);
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash,
          expires_at, status, resolved_at)
       values ('workspace', $1, $2, 'viewer', $1, $3,
               now() + interval '7 days', 'superseded', now())`,
      [owner.id, recipient.email, TOKEN_HASH],
    );

    const response = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ message: 'Invitation was revoked' });
    const invitation = await query<{ status: string }>(
      'select status from pending_invitations where token_hash = $1',
      [TOKEN_HASH],
    );
    expect(invitation.rows[0]?.status).toBe('revoked');

    await query(
      `insert into workspace_members (workspace_owner_id, member_id, role)
       values ($1, $2, 'viewer')`,
      [owner.id, recipient.id],
    );
    const repeated = await app.request(`/api/invitations/claim/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });
    expect(repeated.status).toBe(410);
  });

  it('preserves a declined invitation when the recipient later receives direct access', async () => {
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const page = await createTestPage(owner.id, { title: 'Declined invitation page' });
    const ownerSession = await createTestSession(owner.id);
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, 'declined-then-joined@example.com', 'view', $2, $3,
               now() + interval '7 days')`,
      [page.id, owner.id, TOKEN_HASH],
    );
    const decline = await app.request(`/api/invitations/claim/${TOKEN}/decline`, {
      method: 'POST',
    });
    expect(decline.status).toBe(200);
    const recipient = await createTestUser({ email: 'declined-then-joined@example.com' });

    const grant = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerSession.Cookie },
      body: JSON.stringify({ email: recipient.email, permission: 'edit' }),
    });

    expect(grant.status).toBe(200);
    const invitation = await query<{ status: string }>(
      'select status from pending_invitations where token_hash = $1',
      [TOKEN_HASH],
    );
    expect(invitation.rows[0]?.status).toBe('declined');
  });
});
