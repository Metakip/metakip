import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import { createTestApp, createTestPage, createTestSession, createTestUser } from '../test-utils';
import { decryptInvitationSecret, encryptInvitationSecret } from './invitationCipher';
import { processInvitationDeliveryQueue, runInvitationDeliveryWorker } from './invitationDelivery';

const TOKEN_HASH = createHash('sha256').update('a'.repeat(43)).digest('hex');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('invitation delivery', () => {
  it('measures resend cooldown from the latest provider attempt', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Retry Cooldown Owner' });
    const session = await createTestSession(owner.id);
    const creation = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'recent-attempt@example.com', role: 'viewer' }),
    });
    const body = (await creation.json()) as { invitation: { id: string } };
    const delivery = await query<{ id: string }>(
      'select id from invitation_send_attempts where invitation_id = $1',
      [body.invitation.id],
    );
    const deliveryId = delivery.rows[0]?.id;
    if (!deliveryId) throw new Error('Delivery fixture did not return an ID');
    await query(
      `update invitation_send_attempts
       set status = 'sent', attempts = 1, attempted_at = now() - interval '20 minutes',
           completed_at = now(), next_attempt_at = null
       where id = $1`,
      [deliveryId],
    );
    await query(
      `insert into invitation_email_attempts
         (delivery_id, invitation_id, invited_by, email, attempt_number)
       values ($1, $2, $3, 'recent-attempt@example.com', 1)`,
      [deliveryId, body.invitation.id, owner.id],
    );

    const resend = await app.request(`/api/invitations/${body.invitation.id}/resend`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(resend.status).toBe(429);
    expect(await resend.json()).toEqual({ message: 'Please wait 1 minute before resending' });
  });

  it('rejects manual resends after the sender-recipient daily limit', async () => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Workspace Owner' });
    const session = await createTestSession(owner.id);
    const invitation = await query<{ id: string }>(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('workspace', $1, 'limited@example.com', 'viewer', $1, $2,
               now() + interval '7 days')
       returning id`,
      [owner.id, TOKEN_HASH],
    );
    const invitationId = invitation.rows[0]?.id;
    if (!invitationId) throw new Error('Invitation fixture did not return an ID');
    await query(
      `insert into invitation_send_attempts
         (invitation_id, invited_by, email, token_encrypted, token_hash, status,
          attempted_at, completed_at, next_attempt_at, updated_at)
       select $1, $2, 'limited@example.com', $4, $3, 'sent',
              now() - interval '20 minutes', now() - interval '20 minutes', null,
              now() - interval '20 minutes'
       from generate_series(1, 5)`,
      [invitationId, owner.id, TOKEN_HASH, encryptInvitationSecret('a'.repeat(43))],
    );
    await query(
      `insert into invitation_email_attempts
         (delivery_id, invitation_id, invited_by, email, attempt_number, attempted_at)
       select id, invitation_id, invited_by, email, 1, attempted_at
       from invitation_send_attempts where invitation_id = $1`,
      [invitationId],
    );

    const response = await app.request(`/api/invitations/${invitationId}/resend`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      message: 'Daily invitation email limit for this recipient reached',
    });
  });

  it('allows a manual resend immediately after a failed delivery attempt', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Failed Delivery Owner' });
    const session = await createTestSession(owner.id);
    const creation = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'failed-delivery@example.com', role: 'viewer' }),
    });
    const body = (await creation.json()) as { invitation: { id: string } };
    await query(
      `update invitation_send_attempts
       set status = 'pending', attempts = 1, attempted_at = now(), updated_at = now(),
           next_attempt_at = now() + interval '5 minutes'
       where invitation_id = $1`,
      [body.invitation.id],
    );

    const resend = await app.request(`/api/invitations/${body.invitation.id}/resend`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(resend.status).toBe(200);
  });

  it('applies actual-send limits to automatic delivery attempts', async () => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const owner = await createTestUser({ name: 'Rate Limited Owner' });
    const invitation = await query<{ id: string }>(
      `insert into pending_invitations
         (target_type, target_id, email, permission, invited_by, token_hash, expires_at)
       values ('workspace', $1, 'actual-limit@example.com', 'viewer', $1, $2,
               now() + interval '7 days')
       returning id`,
      [owner.id, TOKEN_HASH],
    );
    const invitationId = invitation.rows[0]?.id;
    if (!invitationId) throw new Error('Invitation fixture did not return an ID');
    const deliveries = await query<{ id: string; status: string }>(
      `insert into invitation_send_attempts
         (invitation_id, invited_by, email, token_encrypted, token_hash, status,
          attempts, attempted_at, completed_at, next_attempt_at)
       values
         ($1, $2, 'actual-limit@example.com', 'old', $3, 'sent', 5,
          now() - interval '20 minutes', now() - interval '20 minutes', null),
         ($1, $2, 'actual-limit@example.com', 'current', $3, 'pending', 0,
          now(), null, now())
       returning id, status`,
      [invitationId, owner.id, TOKEN_HASH],
    );
    const oldDeliveryId = deliveries.rows.find((delivery) => delivery.status === 'sent')?.id;
    const currentDeliveryId = deliveries.rows.find((delivery) => delivery.status === 'pending')?.id;
    if (!oldDeliveryId || !currentDeliveryId) {
      throw new Error('Delivery fixtures did not return both IDs');
    }
    await query(
      `insert into invitation_email_attempts
         (delivery_id, invitation_id, invited_by, email, attempt_number, attempted_at)
       select $1, $2, $3, 'actual-limit@example.com', attempt_number,
              now() - interval '20 minutes'
       from generate_series(1, 5) attempt_number`,
      [oldDeliveryId, invitationId, owner.id],
    );

    expect(await processInvitationDeliveryQueue({ deliveryId: currentDeliveryId })).toEqual({
      failed: 0,
      processed: 0,
    });
    const deferred = await query<{ attempts: number; next_attempt_at: Date; status: string }>(
      `select attempts, next_attempt_at, status
       from invitation_send_attempts where id = $1`,
      [currentDeliveryId],
    );
    expect(deferred.rows[0]).toMatchObject({ attempts: 0, status: 'pending' });
    expect(deferred.rows[0]?.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('reuses the invitation token and supersedes older queued delivery', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Workspace Owner' });
    const session = await createTestSession(owner.id);
    const creation = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'retry@example.com', role: 'viewer' }),
    });
    const created = (await creation.json()) as {
      invitation: { id: string; deliveryStatus: string };
    };
    expect(created.invitation.deliveryStatus).toBe('pending');
    const original = await query<{ token_hash: string }>(
      'select token_hash from pending_invitations where id = $1',
      [created.invitation.id],
    );
    await query(
      `update invitation_send_attempts
       set attempted_at = now() - interval '20 minutes',
           updated_at = now() - interval '20 minutes'
       where invitation_id = $1`,
      [created.invitation.id],
    );

    const response = await app.request(`/api/invitations/${created.invitation.id}/resend`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: 'Invitation queued for retry@example.com',
      invitation: { deliveryStatus: 'pending' },
    });
    const resent = await query<{ token_hash: string }>(
      'select token_hash from pending_invitations where id = $1',
      [created.invitation.id],
    );
    expect(resent.rows[0]?.token_hash).toBe(original.rows[0]?.token_hash);

    const deliveries = await query<{ id: string }>(
      `select id from invitation_send_attempts
       where invitation_id = $1
       order by attempted_at desc, id desc`,
      [created.invitation.id],
    );
    const newestDeliveryId = deliveries.rows[0]?.id;
    const olderDeliveryId = deliveries.rows[1]?.id;
    if (!newestDeliveryId || !olderDeliveryId) {
      throw new Error('Resend fixture did not return both deliveries');
    }
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await query('update invitation_send_attempts set next_attempt_at = now() where id = $1', [
      newestDeliveryId,
    ]);
    await processInvitationDeliveryQueue({ deliveryId: newestDeliveryId });
    await processInvitationDeliveryQueue({ deliveryId: olderDeliveryId });
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const statuses = await query<{ id: string; status: string }>(
      `select id, status from invitation_send_attempts
       where id = any($1::uuid[]) order by id`,
      [[newestDeliveryId, olderDeliveryId]],
    );
    expect(statuses.rows.find(({ id }) => id === newestDeliveryId)?.status).toBe('sent');
    expect(statuses.rows.find(({ id }) => id === olderDeliveryId)?.status).toBe('superseded');
  });

  it('replaces an emailed link when the invitation permission changes', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Page Owner' });
    const page = await createTestPage(owner.id);
    const session = await createTestSession(owner.id);
    const invitePath = `/api/shares/entity/page/${page.id}/grants`;
    const headers = { 'Content-Type': 'application/json', Cookie: session.Cookie };
    const email = 'permission-change@example.com';

    const creation = await app.request(invitePath, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, permission: 'view' }),
    });
    expect(creation.status).toBe(202);
    const { invitation } = (await creation.json()) as { invitation: { id: string } };
    const originalDelivery = await query<{ token_encrypted: string }>(
      'select token_encrypted from invitation_send_attempts where invitation_id = $1',
      [invitation.id],
    );
    const oldSecret = originalDelivery.rows[0]?.token_encrypted;
    if (!oldSecret) throw new Error('Initial delivery token is missing');
    const oldToken = decryptInvitationSecret(oldSecret);
    await query(
      `update invitation_send_attempts
       set status = 'sent', attempts = 1, attempted_at = now() - interval '20 minutes',
           completed_at = now() - interval '20 minutes', next_attempt_at = null
       where invitation_id = $1`,
      [invitation.id],
    );

    const change = await app.request(invitePath, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, permission: 'admin' }),
    });
    expect(change.status).toBe(202);
    const newDelivery = await query<{ token_encrypted: string }>(
      `select token_encrypted from invitation_send_attempts
       where invitation_id = $1 and status = 'pending'`,
      [invitation.id],
    );
    const newSecret = newDelivery.rows[0]?.token_encrypted;
    if (!newSecret) throw new Error('Replacement delivery token is missing');
    const newToken = decryptInvitationSecret(newSecret);
    expect(newToken).not.toBe(oldToken);
    expect((await app.request(`/api/invitations/claim/${oldToken}`)).status).toBe(404);
    const claim = await app.request(`/api/invitations/claim/${newToken}`);
    expect(await claim.json()).toMatchObject({ status: 'pending', permission: 'admin' });

    const recipient = await createTestUser({ email });
    const recipientSession = await createTestSession(recipient.id);
    const oldAcceptance = await app.request(`/api/invitations/claim/${oldToken}`, {
      method: 'POST',
      headers: { Cookie: recipientSession.Cookie },
    });
    expect(oldAcceptance.status).toBe(404);
    const acceptance = await app.request(`/api/invitations/claim/${newToken}`, {
      method: 'POST',
      headers: { Cookie: recipientSession.Cookie },
    });
    expect(acceptance.status).toBe(200);
    const grant = await query<{ permission: string }>(
      `select permission from shares
       where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
      [page.id, recipient.id],
    );
    expect(grant.rows[0]?.permission).toBe('admin');
  });

  it('keeps temporary delivery failures queued and recovers an expired lease', async () => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('Resend unavailable'))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Workspace Owner' });
    const session = await createTestSession(owner.id);

    const response = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'delivery-failure@example.com', role: 'viewer' }),
    });
    const body = (await response.json()) as { invitation: { id: string } };
    await processInvitationDeliveryQueue();
    const attempt = await query<{ attempts: number; id: string; status: string }>(
      `select id, status, attempts from invitation_send_attempts where invitation_id = $1`,
      [body.invitation.id],
    );
    expect(attempt.rows).toEqual([expect.objectContaining({ attempts: 1, status: 'pending' })]);

    const deliveryId = attempt.rows[0]?.id;
    if (!deliveryId) throw new Error('Delivery fixture did not return an ID');
    await query(
      `update invitation_send_attempts
       set status = 'processing', claim_token = gen_random_uuid(),
           lease_until = now() - interval '1 second', next_attempt_at = now()
       where id = $1`,
      [deliveryId],
    );
    expect(await processInvitationDeliveryQueue({ deliveryId })).toEqual({
      failed: 0,
      processed: 1,
    });
    const recovered = await query<{ attempts: number; status: string }>(
      'select status, attempts from invitation_send_attempts where id = $1',
      [deliveryId],
    );
    expect(recovered.rows).toEqual([{ attempts: 2, status: 'sent' }]);
  });

  it('recovers a crashed final attempt so the invitation can be resent', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Final Attempt Owner' });
    const session = await createTestSession(owner.id);
    const creation = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'final-attempt@example.com', role: 'viewer' }),
    });
    const body = (await creation.json()) as { invitation: { id: string } };
    await query(
      `update invitation_send_attempts
       set status = 'processing', attempts = 5,
           claim_token = gen_random_uuid(),
           attempted_at = now() - interval '20 minutes',
           lease_until = now() - interval '1 second', next_attempt_at = now()
       where invitation_id = $1`,
      [body.invitation.id],
    );

    const resend = await app.request(`/api/invitations/${body.invitation.id}/resend`, {
      method: 'POST',
      headers: { Cookie: session.Cookie },
    });

    expect(resend.status).toBe(200);
    const deliveries = await query<{ status: string }>(
      `select status from invitation_send_attempts
       where invitation_id = $1 order by attempted_at asc`,
      [body.invitation.id],
    );
    expect(deliveries.rows.map(({ status }) => status).sort()).toEqual(['failed', 'pending']);
  });

  it('retries a crashed final provider call with the same delivery record', async () => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Final Recovery Owner' });
    const session = await createTestSession(owner.id);
    const creation = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'final-recovery@example.com', role: 'viewer' }),
    });
    const body = (await creation.json()) as { invitation: { id: string } };
    await query(
      `update invitation_send_attempts
       set status = 'processing', attempts = 5,
           claim_token = gen_random_uuid(),
           lease_until = now() - interval '1 second', next_attempt_at = now()
       where invitation_id = $1`,
      [body.invitation.id],
    );

    expect(await processInvitationDeliveryQueue()).toEqual({ failed: 0, processed: 1 });
    const delivery = await query<{ attempts: number; status: string }>(
      'select attempts, status from invitation_send_attempts where invitation_id = $1',
      [body.invitation.id],
    );
    expect(delivery.rows).toEqual([{ attempts: 5, status: 'sent' }]);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('fences finalization when an expired final-attempt lease is reclaimed', async () => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Fenced Final Attempt Owner' });
    const session = await createTestSession(owner.id);
    const creation = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'fenced-final@example.com', role: 'viewer' }),
    });
    const body = (await creation.json()) as { invitation: { id: string } };
    const delivery = await query<{ id: string }>(
      'select id from invitation_send_attempts where invitation_id = $1',
      [body.invitation.id],
    );
    const deliveryId = delivery.rows[0]?.id;
    if (!deliveryId) throw new Error('Delivery fixture did not return an ID');
    await query(
      `update invitation_send_attempts
       set status = 'processing', attempts = 5, claim_token = gen_random_uuid(),
           lease_until = now() - interval '1 second', next_attempt_at = now()
       where id = $1`,
      [deliveryId],
    );

    let firstStarted!: () => void;
    let secondStarted!: () => void;
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const firstRequestStarted = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const secondRequestStarted = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => {
        firstStarted();
        return firstResponse;
      })
      .mockImplementationOnce(() => {
        secondStarted();
        return secondResponse;
      });

    const firstWorker = processInvitationDeliveryQueue({ deliveryId });
    await firstRequestStarted;
    const firstClaim = await query<{ claim_token: string }>(
      'select claim_token from invitation_send_attempts where id = $1',
      [deliveryId],
    );
    await query(
      `update invitation_send_attempts
       set lease_until = now() - interval '1 second' where id = $1`,
      [deliveryId],
    );
    const replacementWorker = processInvitationDeliveryQueue({ deliveryId });
    await secondRequestStarted;
    const replacementClaim = await query<{ claim_token: string }>(
      'select claim_token from invitation_send_attempts where id = $1',
      [deliveryId],
    );
    expect(replacementClaim.rows[0]?.claim_token).not.toBe(firstClaim.rows[0]?.claim_token);

    resolveFirst(new Response(null, { status: 200 }));
    await expect(firstWorker).resolves.toEqual({ failed: 1, processed: 0 });
    resolveSecond(new Response(null, { status: 200 }));
    await expect(replacementWorker).resolves.toEqual({ failed: 0, processed: 1 });
    const completed = await query<{ status: string }>(
      'select status from invitation_send_attempts where id = $1',
      [deliveryId],
    );
    expect(completed.rows[0]?.status).toBe('sent');
  });

  it('leaves queued delivery untouched while email configuration is unavailable', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Unconfigured Email Owner' });
    const session = await createTestSession(owner.id);
    const creation = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'waiting-for-config@example.com', role: 'viewer' }),
    });
    const body = (await creation.json()) as { invitation: { id: string } };

    expect(await processInvitationDeliveryQueue()).toEqual({ failed: 0, processed: 0 });
    const delivery = await query<{ attempts: number; status: string }>(
      'select attempts, status from invitation_send_attempts where invitation_id = $1',
      [body.invitation.id],
    );
    expect(delivery.rows).toEqual([{ attempts: 0, status: 'pending' }]);
  });

  it('fails permanent provider errors without retrying', async () => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Permanent Failure Owner' });
    const session = await createTestSession(owner.id);
    const response = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'permanent-failure@example.com', role: 'viewer' }),
    });
    const body = (await response.json()) as { invitation: { id: string } };

    expect(await processInvitationDeliveryQueue()).toEqual({ failed: 1, processed: 0 });
    const attempt = await query<{
      attempts: number;
      completed_at: Date | null;
      next_attempt_at: Date | null;
      status: string;
    }>(
      `select status, attempts, completed_at, next_attempt_at
       from invitation_send_attempts where invitation_id = $1`,
      [body.invitation.id],
    );
    expect(attempt.rows[0]).toMatchObject({ attempts: 1, next_attempt_at: null, status: 'failed' });
    expect(attempt.rows[0]?.completed_at).not.toBeNull();
    const members = await app.request('/api/workspace/members', {
      headers: { Cookie: session.Cookie },
    });
    expect(await members.json()).toMatchObject({
      pendingInvitations: [{ id: body.invitation.id, deliveryStatus: 'failed' }],
    });
  });

  it('exposes temporary failure only after retry exhaustion', async () => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Resend unavailable'));
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Workspace Owner' });
    const session = await createTestSession(owner.id);
    const response = await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'terminal-failure@example.com', role: 'viewer' }),
    });
    const body = (await response.json()) as { invitation: { id: string } };
    const attempt = await query<{ id: string }>(
      'select id from invitation_send_attempts where invitation_id = $1',
      [body.invitation.id],
    );
    const attemptId = attempt.rows[0]?.id;
    if (!attemptId) throw new Error('Delivery fixture did not return an ID');
    await query(
      `update invitation_send_attempts
       set attempts = 4, next_attempt_at = now(), updated_at = now() - interval '20 minutes'
       where id = $1`,
      [attemptId],
    );

    expect(await processInvitationDeliveryQueue({ deliveryId: attemptId })).toEqual({
      failed: 1,
      processed: 0,
    });
    const terminal = await query<{
      completed_at: Date | null;
      next_attempt_at: Date | null;
      status: string;
    }>('select status, completed_at, next_attempt_at from invitation_send_attempts where id = $1', [
      attemptId,
    ]);
    expect(terminal.rows[0]).toMatchObject({ next_attempt_at: null, status: 'failed' });
    expect(terminal.rows[0]?.completed_at).not.toBeNull();
  });

  it.each([
    'retry',
    'lease-recovery',
  ] as const)('replays the frozen email during %s despite renamed targets and sender changes', async (recovery) => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM_EMAIL', 'Original Sender <original@example.com>');
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Original Owner' });
    const page = await createTestPage(owner.id, { title: 'Original title' });
    const session = await createTestSession(owner.id);
    const creation = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'immutable-email@example.com', permission: 'view' }),
    });
    expect(creation.status).toBe(202);
    const created = (await creation.json()) as { invitation: { id: string } };
    const deliveries = await query<{ id: string }>(
      'select id from invitation_send_attempts where invitation_id = $1',
      [created.invitation.id],
    );
    const deliveryId = deliveries.rows[0]?.id;
    if (!deliveryId) throw new Error('Delivery fixture did not return an ID');

    let bodyStoredBeforeSending: string | null = null;
    let encryptedBodyStoredBeforeSending: string | null = null;
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => {
        // The request must be durable before the first external call, not
        // merely saved after the provider reports a failure.
        const stored = await query<{ email_body_encrypted: string | null }>(
          'select email_body_encrypted from invitation_send_attempts where id = $1',
          [deliveryId],
        );
        encryptedBodyStoredBeforeSending = stored.rows[0]?.email_body_encrypted ?? null;
        bodyStoredBeforeSending = encryptedBodyStoredBeforeSending
          ? decryptInvitationSecret(encryptedBodyStoredBeforeSending)
          : null;
        throw new Error('Provider response was lost');
      })
      .mockResolvedValue(new Response(null, { status: 200 }));

    expect(await processInvitationDeliveryQueue({ deliveryId })).toEqual({
      failed: 1,
      processed: 0,
    });
    // Assert outside the provider mock so the worker cannot catch assertion
    // failures and mistake them for the simulated network failure.
    expect(bodyStoredBeforeSending).toBe(provider.mock.calls[0]?.[1]?.body);
    expect(encryptedBodyStoredBeforeSending).not.toBe(bodyStoredBeforeSending);
    await query('update pages set title = $1 where id = $2', ['Renamed title', page.id]);
    await query('update users set name = $1 where id = $2', ['Renamed Owner', owner.id]);
    vi.stubEnv('RESEND_FROM_EMAIL', 'New Sender <new@example.com>');
    if (recovery === 'lease-recovery') {
      await query(
        `update invitation_send_attempts set status = 'processing',
             claim_token = gen_random_uuid(),
             lease_until = now() - interval '1 second', next_attempt_at = now()
           where id = $1`,
        [deliveryId],
      );
    } else {
      await query('update invitation_send_attempts set next_attempt_at = now() where id = $1', [
        deliveryId,
      ]);
    }

    expect(await processInvitationDeliveryQueue({ deliveryId })).toEqual({
      failed: 0,
      processed: 1,
    });
    expect(provider).toHaveBeenCalledTimes(2);
    const firstRequest = provider.mock.calls[0]?.[1];
    const retriedRequest = provider.mock.calls[1]?.[1];
    expect(firstRequest?.body).toContain('Original title');
    expect(firstRequest?.body).toContain('Original Owner');
    expect(firstRequest?.body).toContain('original@example.com');
    expect(retriedRequest?.body).toBe(firstRequest?.body);
    expect(new Headers(retriedRequest?.headers).get('Idempotency-Key')).toBe(deliveryId);
    expect(new Headers(firstRequest?.headers).get('Idempotency-Key')).toBe(deliveryId);
  });

  it.each([
    0, 5,
  ])('finalizes a deleted target after %i attempts and continues the queue', async (attempts) => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const provider = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const app = await createTestApp();
    const owner = await createTestUser();
    const page = await createTestPage(owner.id);
    const session = await createTestSession(owner.id);
    const headers = { 'Content-Type': 'application/json', Cookie: session.Cookie };
    const creation = await app.request(`/api/shares/entity/page/${page.id}/grants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'deleted-target@example.com', permission: 'view' }),
    });
    expect(creation.status).toBe(202);
    const created = (await creation.json()) as { invitation: { id: string } };
    // Guarantee that the invalid job is in the first group of four jobs.
    await query(
      `update invitation_send_attempts
       set next_attempt_at = now() - interval '1 minute', attempts = $2,
           status = $3,
           claim_token = case when $3 = 'processing' then gen_random_uuid() else null end,
           lease_until = $4
       where invitation_id = $1`,
      [
        created.invitation.id,
        attempts,
        attempts === 0 ? 'pending' : 'processing',
        attempts === 0 ? null : new Date(Date.now() - 60_000),
      ],
    );
    await query('update pages set is_deleted = true where id = $1', [page.id]);
    for (let index = 0; index < 5; index += 1) {
      const queued = await app.request('/api/workspace/members/invite', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: `valid-delivery-${index}@example.com`, role: 'viewer' }),
      });
      expect(queued.status).toBe(202);
    }

    expect(await processInvitationDeliveryQueue()).toEqual({ failed: 1, processed: 5 });
    expect(provider).toHaveBeenCalledTimes(5);
    const failed = await query<{
      status: string;
      lease_until: Date | null;
      next_attempt_at: Date | null;
    }>(
      `select status, lease_until, next_attempt_at from invitation_send_attempts
       where invitation_id = $1`,
      [created.invitation.id],
    );
    expect(failed.rows).toEqual([{ status: 'failed', lease_until: null, next_attempt_at: null }]);
    expect(await processInvitationDeliveryQueue()).toEqual({ failed: 0, processed: 0 });
  });

  it('runs the background worker as a single flight', async () => {
    vi.stubEnv('RESEND_ENABLE_TEST_DELIVERY', 'true');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const app = await createTestApp();
    const owner = await createTestUser({ name: 'Worker Owner' });
    const session = await createTestSession(owner.id);
    await app.request('/api/workspace/members/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
      body: JSON.stringify({ email: 'worker@example.com', role: 'viewer' }),
    });

    const first = runInvitationDeliveryWorker();
    const second = runInvitationDeliveryWorker();

    expect(second).toBe(first);
    await first;
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });
});
