import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';
import { testQuery as query } from '../db/testQuery';
import { createTestApp, createTestUser } from '../test-utils';
import { ensureAccountSetupComplete, WELCOME_PAGE_TITLE } from './welcomePage';

describe('account setup locks', () => {
  it('creates welcome content once when signup and invitation provisioning overlap', async () => {
    await createTestApp();
    const user = await createTestUser();
    await Promise.all([
      db.transaction((tx) => ensureAccountSetupComplete(tx, user.id)),
      db.transaction((tx) => ensureAccountSetupComplete(tx, user.id)),
    ]);

    const pages = await query<{ id: string }>(
      'select id from pages where created_by = $1 and title = $2',
      [user.id, WELCOME_PAGE_TITLE],
    );
    expect(pages.rowCount).toBe(1);
    const favorites = await query(
      `select id from user_favorites where user_id = $1 and entity_type = 'page' and entity_id = $2`,
      [user.id, pages.rows[0]?.id],
    );
    expect(favorites.rowCount).toBe(1);
    const account = await query<{
      account_setup_completed_at: Date | null;
      onboarding_completed_at: Date | null;
    }>('select account_setup_completed_at, onboarding_completed_at from users where id = $1', [
      user.id,
    ]);
    expect(account.rows[0]?.account_setup_completed_at).not.toBeNull();
    expect(account.rows[0]?.onboarding_completed_at).toBeNull();
  });
});
