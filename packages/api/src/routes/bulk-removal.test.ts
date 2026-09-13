import type { BulkRemovalResult } from '@metakip/shared';
import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import { createTestApp, createTestPage, createTestSession, createTestUser } from '../test-utils';

const jsonHeaders = (cookie: string) => ({
  Cookie: cookie,
  'Content-Type': 'application/json',
});

describe('POST /api/bulk-removal', () => {
  it('requires authentication', async () => {
    const app = await createTestApp();
    const response = await app.request('/api/bulk-removal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [] }),
    });
    expect(response.status).toBe(401);
  });

  it('returns successful and failed item outcomes without rolling successful items back', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const otherOwner = await createTestUser();
    const session = await createTestSession(user.id);
    const ownedPage = await createTestPage(user.id, { title: 'Owned page' });
    const sharedPage = await createTestPage(otherOwner.id, { title: 'Shared page' });
    await query(
      `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
       values ('page', $1, $2, $3, 'view')`,
      [sharedPage.id, otherOwner.id, user.id],
    );
    const missingPageId = crypto.randomUUID();

    const response = await app.request('/api/bulk-removal', {
      method: 'POST',
      headers: jsonHeaders(session.Cookie),
      body: JSON.stringify({
        operations: [
          { entityType: 'page', entityId: ownedPage.id, action: 'trash' },
          { entityType: 'page', entityId: sharedPage.id, action: 'remove-from-view' },
          { entityType: 'page', entityId: missingPageId, action: 'trash' },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const result = (await response.json()) as BulkRemovalResult;
    expect(result).toEqual({
      removedItems: [
        { entityType: 'page', entityId: ownedPage.id, action: 'trash' },
        { entityType: 'page', entityId: sharedPage.id, action: 'remove-from-view' },
      ],
      failedItems: [
        {
          entityType: 'page',
          entityId: missingPageId,
          action: 'trash',
          code: 'NOT_FOUND',
          message: 'Page not found',
        },
      ],
      trashedCount: 1,
      removedFromViewCount: 1,
    });

    const persisted = await query<{
      owned_deleted: boolean;
      shared_grant_exists: boolean;
    }>(
      `select
         (select is_deleted from pages where id = $1) as owned_deleted,
         exists(
           select 1 from shares
           where entity_type = 'page' and entity_id = $2 and recipient_user_id = $3
         ) as shared_grant_exists`,
      [ownedPage.id, sharedPage.id, user.id],
    );
    expect(persisted.rows[0]).toEqual({ owned_deleted: true, shared_grant_exists: false });
  });

  it('rejects duplicate entities before processing', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id);
    const operation = { entityType: 'page', entityId: page.id, action: 'trash' };

    const response = await app.request('/api/bulk-removal', {
      method: 'POST',
      headers: jsonHeaders(session.Cookie),
      body: JSON.stringify({ operations: [operation, operation] }),
    });

    expect(response.status).toBe(400);
    const persisted = await query<{ is_deleted: boolean }>(
      'select is_deleted from pages where id = $1',
      [page.id],
    );
    expect(persisted.rows[0]?.is_deleted).toBe(false);
  });
});
