import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import {
  createTestApp,
  createTestSession,
  createTestUser,
  createTestWorkspaceMember,
} from '../test-utils';

describe('workspace API', () => {
  it('returns 401 without a session', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/workspace/memberships');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid session', async () => {
    const app = await createTestApp();
    const res = await app.request('/api/workspace/memberships', {
      headers: { Cookie: 'better-auth.session_token=invalid-token' },
    });
    expect(res.status).toBe(401);
  });

  it.each([
    ['POST', '/api/workspace/members/invite'],
    ['PATCH', `/api/workspace/members/${crypto.randomUUID()}/role`],
  ] as const)('returns 400 for malformed JSON on %s workspace requests', async (method, path) => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);
    const response = await app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: '{',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Malformed JSON body' });
  });

  it('lists workspaces the current user has joined', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const member = await createTestUser();
    const session = await createTestSession(member.id);
    await createTestWorkspaceMember(owner.id, member.id, 'viewer');

    const res = await app.request('/api/workspace/memberships', {
      headers: { Cookie: session.Cookie },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toContainEqual(
      expect.objectContaining({ ownerId: owner.id, ownerName: owner.name, role: 'viewer' }),
    );
  });

  it('rejects an invalid role instead of granting editor access', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const session = await createTestSession(owner.id);

    const res = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: recipient.email, role: 'edtor' }),
    });

    expect(res.status).toBe(400);
    const membership = await query(
      'SELECT id FROM workspace_members WHERE workspace_owner_id = $1 AND member_id = $2',
      [owner.id, recipient.id],
    );
    expect(membership.rowCount).toBe(0);
  });

  it('matches invitation email addresses case-insensitively', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser({ email: 'Mixed.Case@Example.com' });
    const session = await createTestSession(owner.id);

    const res = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'mixed.case@example.com', role: 'viewer' }),
    });

    expect(res.status).toBe(200);
    const membership = await query(
      'SELECT id FROM workspace_members WHERE workspace_owner_id = $1 AND member_id = $2',
      [owner.id, recipient.id],
    );
    expect(membership.rowCount).toBe(1);
  });

  it('creates a pending invitation when the email has no account', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);

    const res = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'New.Member@Example.com', role: 'viewer' }),
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(
      expect.objectContaining({
        message: 'Invitation queued for new.member@example.com',
        invitation: expect.objectContaining({ deliveryStatus: 'pending' }),
      }),
    );
    const invitations = await query<{ email: string; permission: string }>(
      `select email, permission from pending_invitations
       where target_type = 'workspace' and target_id = $1`,
      [owner.id],
    );
    expect(invitations.rows).toEqual([{ email: 'new.member@example.com', permission: 'viewer' }]);

    const membersResponse = await app.request('/api/workspace/members', {
      headers: { Cookie: session.Cookie },
    });
    expect(membersResponse.status).toBe(200);
    expect(await membersResponse.json()).toMatchObject({
      members: expect.any(Array),
      pendingInvitations: [
        expect.objectContaining({
          targetType: 'workspace',
          email: 'new.member@example.com',
          permission: 'viewer',
          canManage: true,
        }),
      ],
    });
  });

  it("allows two users to join each other's separate workspaces", async () => {
    const app = await createTestApp();
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const aliceSession = await createTestSession(alice.id);
    await createTestWorkspaceMember(bob.id, alice.id, 'viewer');

    const res = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceSession.Cookie },
      body: JSON.stringify({ email: bob.email, role: 'editor' }),
    });

    expect(res.status).toBe(200);
    const memberships = await query<{ workspace_owner_id: string; member_id: string }>(
      `SELECT workspace_owner_id, member_id FROM workspace_members
       WHERE (workspace_owner_id = $1 AND member_id = $2)
          OR (workspace_owner_id = $2 AND member_id = $1)`,
      [alice.id, bob.id],
    );
    expect(memberships.rows).toHaveLength(2);
  });

  it('lets a member leave a specific workspace', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const member = await createTestUser();
    const session = await createTestSession(member.id);
    await createTestWorkspaceMember(owner.id, member.id, 'editor');

    const res = await app.request(
      `/api/workspace/members/${member.id}?workspaceOwnerId=${owner.id}`,
      { method: 'DELETE', headers: { Cookie: session.Cookie } },
    );

    expect(res.status).toBe(200);
    const membership = await query(
      'SELECT id FROM workspace_members WHERE workspace_owner_id = $1 AND member_id = $2',
      [owner.id, member.id],
    );
    expect(membership.rowCount).toBe(0);
  });
});
