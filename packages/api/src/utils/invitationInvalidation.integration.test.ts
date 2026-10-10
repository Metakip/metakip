import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';
import { executeQuery } from '../db/query';
import { testQuery as query } from '../db/testQuery';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../test-utils';
import { lockWorkspaceAccessMutation } from './share-access';

const TOKEN = 'i'.repeat(43);
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

describe('invitation invalidation at access commit', () => {
  it.each([
    'page-grant',
    'folder-grant',
    'workspace-role',
    'inheritance',
  ] as const)('does not revive an invitation after restoring %s without visiting its link', async (source) => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const admin = await createTestUser();
    const folder = await createTestFolder(owner.id);
    const page = await createTestPage(owner.id, { parentId: folder.id });
    const session = await createTestSession(owner.id);
    const headers = { 'Content-Type': 'application/json', Cookie: session.Cookie };

    let path: string;
    let removeAuthority: object;
    let restoreAuthority: object;
    if (source === 'page-grant' || source === 'folder-grant') {
      const grant = await query<{ id: string }>(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
           values ($1, $2, $3, $4, 'admin') returning id`,
        [
          source === 'page-grant' ? 'page' : 'folder',
          source === 'page-grant' ? page.id : folder.id,
          owner.id,
          admin.id,
        ],
      );
      path = `/api/shares/grants/${grant.rows[0]?.id}`;
      removeAuthority = { permission: 'edit' };
      restoreAuthority = { permission: 'admin' };
    } else {
      await query(
        `insert into workspace_members (workspace_owner_id, member_id, role) values ($1, $2, 'admin')`,
        [owner.id, admin.id],
      );
      path =
        source === 'workspace-role'
          ? `/api/workspace/members/${admin.id}/role`
          : `/api/shares/entity/page/${page.id}/inheritance`;
      removeAuthority = source === 'workspace-role' ? { role: 'editor' } : { policy: 'restricted' };
      restoreAuthority = source === 'workspace-role' ? { role: 'admin' } : { policy: 'inherit' };
    }
    await query(
      `insert into pending_invitations
           (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
         values ('page', $1, 'unread@example.com', 'edit', $2, $3, now() + interval '7 days')`,
      [page.id, admin.id, TOKEN_HASH],
    );

    expect(
      (await app.request(path, { method: 'PATCH', headers, body: JSON.stringify(removeAuthority) }))
        .status,
    ).toBe(200);
    // Check persistence before any invitation read or command can repair it.
    const revoked = await query<{ status: string }>(
      'select status from pending_invitations where token_hash = $1',
      [TOKEN_HASH],
    );
    expect(revoked.rows[0]?.status).toBe('revoked');
    expect(
      (
        await app.request(path, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(restoreAuthority),
        })
      ).status,
    ).toBe(200);
    const claim = await app.request(`/api/invitations/claim/${TOKEN}`);
    expect(await claim.json()).toMatchObject({ status: 'revoked' });
  });

  it('keeps superseded invitations revoked after replacement membership is removed and restored', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const recipient = await createTestUser();
    const session = await createTestSession(owner.id);
    const headers = { 'Content-Type': 'application/json', Cookie: session.Cookie };
    await query(
      `insert into workspace_members (workspace_owner_id, member_id, role) values ($1, $2, 'viewer')`,
      [owner.id, recipient.id],
    );
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at, status, resolved_at)
       values ('workspace', $1, $2, 'viewer', $1, $3, now() + interval '7 days', 'superseded', now())`,
      [owner.id, recipient.email, TOKEN_HASH],
    );
    expect(
      (await app.request(`/api/workspace/members/${recipient.id}`, { method: 'DELETE', headers }))
        .status,
    ).toBe(200);
    expect(
      (
        await app.request('/api/workspace/members/invite', {
          method: 'POST',
          headers,
          body: JSON.stringify({ email: recipient.email, role: 'viewer' }),
        })
      ).status,
    ).toBe(200);
    const claim = await app.request(`/api/invitations/claim/${TOKEN}`);
    expect(await claim.json()).toMatchObject({ status: 'revoked' });
  });

  it('does not revoke invitations when an access change rolls back', async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const page = await createTestPage(owner.id);
    await query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'admin')`,
      [page.id, owner.id, admin.id],
    );
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, 'rollback@example.com', 'edit', $2, $3, now() + interval '7 days')`,
      [page.id, admin.id, TOKEN_HASH],
    );
    await expect(
      db.transaction(async (tx) => {
        await lockWorkspaceAccessMutation(tx, owner.id);
        await executeQuery(
          tx,
          sql`update shares set permission = 'edit'
        where entity_id = ${page.id} and recipient_user_id = ${admin.id}`,
        );
        throw new Error('Abort access change');
      }),
    ).rejects.toThrow('Abort access change');
    const invitation = await query<{ status: string }>(
      'select status from pending_invitations where token_hash = $1',
      [TOKEN_HASH],
    );
    expect(invitation.rows[0]?.status).toBe('pending');
  });
});
