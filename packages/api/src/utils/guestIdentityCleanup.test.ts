import { randomUUID } from 'node:crypto';
import { getAnonymousName } from '@metakip/shared';
import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import { persistGuestIdentity, type RequestActor } from './guestAccess';
import { cleanupExpiredGuestIdentities, drainExpiredGuestIdentities } from './guestIdentityCleanup';

describe('guest identity expiry', () => {
  it('locks, deletes, and tombstones an unreferenced expired identity', async () => {
    const guestId = randomUUID();
    await query(
      `insert into guest_identities (id, name, created_at, last_seen_at)
       values ($1, 'Expired guest', now() - interval '91 days', now() - interval '91 days')`,
      [guestId],
    );

    await expect(cleanupExpiredGuestIdentities()).resolves.toBe(1);
    const result = await query<{ identity_exists: boolean; tombstone_exists: boolean }>(
      `select
         exists(select 1 from guest_identities where id = $1) as identity_exists,
         exists(select 1 from guest_identity_tombstones where id = $1) as tombstone_exists`,
      [guestId],
    );
    expect(result.rows[0]).toEqual({ identity_exists: false, tombstone_exists: true });
  });

  it('processes expired identities in bounded batches', async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    await query(
      `insert into guest_identities (id, name, created_at, last_seen_at)
       values
         ($1, 'First expired guest', now() - interval '92 days', now() - interval '92 days'),
         ($2, 'Second expired guest', now() - interval '91 days', now() - interval '91 days')`,
      [firstId, secondId],
    );

    await expect(cleanupExpiredGuestIdentities(undefined, 90, 1)).resolves.toBe(1);
    const remaining = await query<{ count: string }>(
      'select count(*)::text as count from guest_identities where id = any($1::uuid[])',
      [[firstId, secondId]],
    );
    expect(remaining.rows[0]?.count).toBe('1');
  });

  it('drains every bounded batch without waiting for the next daily run', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await query(
      `insert into guest_identities (id, name, created_at, last_seen_at)
       select id, 'Expired guest', now() - interval '91 days', now() - interval '91 days'
       from unnest($1::uuid[]) as input(id)`,
      [ids],
    );

    await expect(drainExpiredGuestIdentities(undefined, 90, 1)).resolves.toBe(3);
    const remaining = await query<{ count: string }>(
      'select count(*)::text as count from guest_identities where id = any($1::uuid[])',
      [ids],
    );
    expect(remaining.rows[0]?.count).toBe('0');
  });

  it('rotates rather than recreating an identity tombstoned after request authentication', async () => {
    const expiredId = randomUUID();
    const replacementId = randomUUID();
    await query('insert into guest_identity_tombstones (id) values ($1)', [expiredId]);

    const actor: Extract<RequestActor, { kind: 'guest' }> = {
      kind: 'guest',
      id: expiredId,
      name: getAnonymousName(expiredId),
      rotate: () => {
        actor.id = replacementId;
        actor.name = getAnonymousName(replacementId);
      },
    };

    await persistGuestIdentity(actor);

    expect(actor.id).toBe(replacementId);
    const identities = await query<{ id: string }>(
      'select id from guest_identities where id = any($1::uuid[]) order by id',
      [[expiredId, replacementId]],
    );
    expect(identities.rows).toEqual([{ id: replacementId }]);
  });
});
