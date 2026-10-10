import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import { createTestPage, createTestUser } from '../test-utils';
import { drainOperationalRetention } from './dataRetention';

describe('invitation retention', () => {
  it('retains only required delivery history and removes orphaned targets', async () => {
    const owner = await createTestUser({ name: 'Retention Owner' });
    const page = await createTestPage(owner.id, { title: 'Retained page' });
    const active = await query<{ id: string }>(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('page', $1, 'active@example.com', 'view', $2, $3,
               now() + interval '7 days')
       returning id`,
      [page.id, owner.id, createHash('sha256').update('active').digest('hex')],
    );
    const activeId = active.rows[0]?.id;
    if (!activeId) throw new Error('Active invitation fixture did not return an ID');
    await query(
      `insert into invitation_send_attempts
         (invitation_id, invited_by, email, token_encrypted, token_hash, status,
          attempted_at, completed_at, next_attempt_at, updated_at)
       values
         ($1, $2, 'active@example.com', 'old', $3, 'sent',
          now() - interval '25 hours', now() - interval '25 hours', null,
          now() - interval '25 hours'),
         ($1, $2, 'active@example.com', 'current', $3, 'sent',
          now(), now(), null, now())`,
      [activeId, owner.id, createHash('sha256').update('active').digest('hex')],
    );
    await query(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash,
          expires_at, status, resolved_at, accepted_by)
       values
         ('page', $1, 'accepted@example.com', 'view', $2, $3,
          now() + interval '7 days', 'accepted', now() - interval '8 days', $2),
         ('page', $1, 'expired@example.com', 'view', $2, $4,
          now() - interval '8 days', 'pending', null, null),
         ('page', $5, 'orphan@example.com', 'view', $2, $6,
          now() + interval '7 days', 'pending', null, null)`,
      [
        page.id,
        owner.id,
        createHash('sha256').update('accepted').digest('hex'),
        createHash('sha256').update('expired').digest('hex'),
        randomUUID(),
        createHash('sha256').update('orphan').digest('hex'),
      ],
    );
    const orphan = await query<{ id: string }>(
      "select id from pending_invitations where email = 'orphan@example.com'",
    );
    const orphanId = orphan.rows[0]?.id;
    if (!orphanId) throw new Error('Orphan invitation fixture did not return an ID');
    await query(
      `insert into invitation_email_attempts
         (delivery_id, invitation_id, invited_by, email, attempt_number, attempted_at)
       values ($1, $2, $3, 'orphan@example.com', 1, now()),
              ($4, $2, $3, 'orphan@example.com', 1, now() - interval '26 hours')`,
      [randomUUID(), orphanId, owner.id, randomUUID()],
    );

    const cleanup = await drainOperationalRetention();

    expect(cleanup.invitationSendAttempts).toBe(1);
    expect(cleanup.invitationEmailAttempts).toBe(1);
    expect(cleanup.pendingInvitations).toBe(3);
    const invitations = await query<{ email: string }>(
      'select email from pending_invitations order by email',
    );
    expect(invitations.rows).toEqual([{ email: 'active@example.com' }]);
    const attempts = await query<{ token_encrypted: string }>(
      'select token_encrypted from invitation_send_attempts where invitation_id = $1',
      [activeId],
    );
    expect(attempts.rows).toEqual([{ token_encrypted: 'current' }]);
    const rateLimitHistory = await query<{ count: string }>(
      'select count(*)::text as count from invitation_email_attempts where invitation_id = $1',
      [orphanId],
    );
    expect(rateLimitHistory.rows[0]?.count).toBe('1');
  });
});
