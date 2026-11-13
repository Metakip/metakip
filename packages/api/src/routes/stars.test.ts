import { describe, expect, it } from 'vitest';
import { testQuery as query } from '../db/testQuery';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
  createTestWorkspaceMember,
} from '../test-utils';

describe('stars API', () => {
  describe('auth guard', () => {
    it('returns 401 without session cookie', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/stars');
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid session token', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/stars', {
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/stars', () => {
    it('lists stars for the user', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });

      const res = await app.request(`/api/stars`, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.stars.length).toBeGreaterThanOrEqual(1);
      expect(body.stars[0]).toMatchObject({ entityType: 'page', entityId: page.id });
      expect(body.stars[0]).not.toHaveProperty('pageId');
    });

    it('preserves a direct source for a starred page nested in a shared folder', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const recipientSession = await createTestSession(recipient.id);
      const sharedFolder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, { parentId: sharedFolder.id });

      await query(
        `INSERT INTO shares (entity_type, entity_id, recipient_user_id, permission)
         VALUES ('folder', $1, $2, 'view'), ('page', $3, $2, 'view')`,
        [sharedFolder.id, recipient.id, page.id],
      );

      const addStar = await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: recipientSession.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });
      expect(addStar.status).toBe(201);

      const stars = await app.request('/api/stars', {
        headers: { Cookie: recipientSession.Cookie },
      });
      expect(stars.status).toBe(200);
      const body = (await stars.json()) as { stars: Array<Record<string, unknown>> };
      expect(body.stars).toContainEqual(
        expect.objectContaining({ entityId: page.id, shareSource: 'direct' }),
      );
    });

    it('preserves a public source for a starred nested page with a public visit', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const visitor = await createTestUser();
      const visitorSession = await createTestSession(visitor.id);
      const publicFolder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, { parentId: publicFolder.id });

      await query("UPDATE folders SET public_permission = 'view' WHERE id = $1", [publicFolder.id]);

      const folderVisit = await app.request(`/api/folders/${publicFolder.id}`, {
        headers: { Cookie: visitorSession.Cookie },
      });
      expect(folderVisit.status).toBe(200);

      const pageVisit = await app.request(`/api/pages/${page.id}`, {
        headers: { Cookie: visitorSession.Cookie },
      });
      expect(pageVisit.status).toBe(200);

      const addStar = await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: visitorSession.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });
      expect(addStar.status).toBe(201);

      const stars = await app.request('/api/stars', {
        headers: { Cookie: visitorSession.Cookie },
      });
      expect(stars.status).toBe(200);
      const body = (await stars.json()) as { stars: Array<Record<string, unknown>> };
      expect(body.stars).toContainEqual(
        expect.objectContaining({ entityId: page.id, shareSource: 'public' }),
      );

      const removeFromView = await app.request('/api/bulk-removal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: visitorSession.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          operations: [{ entityType: 'page', entityId: page.id, action: 'remove-from-view' }],
        }),
      });
      expect(removeFromView.status).toBe(200);
      expect(await removeFromView.json()).toMatchObject({
        removedFromViewCount: 1,
        failedItems: [],
      });
    });

    it('returns workspace when workspace access supersedes a direct grant', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const member = await createTestUser();
      const memberSession = await createTestSession(member.id);
      const page = await createTestPage(owner.id);
      await createTestWorkspaceMember(owner.id, member.id, 'viewer');
      await query(
        `INSERT INTO shares (entity_type, entity_id, recipient_user_id, permission)
         VALUES ('page', $1, $2, 'view')`,
        [page.id, member.id],
      );

      const addStar = await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: memberSession.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });
      expect(addStar.status).toBe(201);

      const stars = await app.request('/api/stars', {
        headers: { Cookie: memberSession.Cookie },
      });
      expect(stars.status).toBe(200);
      const body = (await stars.json()) as { stars: Array<Record<string, unknown>> };
      expect(body.stars).toContainEqual(
        expect.objectContaining({ entityId: page.id, shareSource: 'workspace' }),
      );
    });
  });

  describe('POST /api/stars', () => {
    it('stars a page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });

      expect(res.status).toBe(201);
    });

    it('stars a folder', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const folder = await createTestFolder(user.id, { name: 'Starred Folder' });

      const res = await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'folder', entityId: folder.id }),
      });

      expect(res.status).toBe(201);

      const listRes = await app.request('/api/stars', {
        headers: { Cookie: session.Cookie },
      });
      expect(listRes.status).toBe(200);
      const body = await listRes.json();
      expect(body.stars).toContainEqual(
        expect.objectContaining({
          entityType: 'folder',
          entityId: folder.id,
          title: 'Starred Folder',
        }),
      );
    });

    it('is idempotent (starring twice returns 200)', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });

      const res = await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });

      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);
    });

    it.each([
      {},
      { entityType: 'page' },
      { entityId: 'page-1' },
    ])('returns 400 when entityType or entityId is missing (%j)', async (body) => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          entityType: 'page',
          entityId: '00000000-0000-0000-0000-000000000000',
        }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/stars/:entityType/:entityId', () => {
    it('unstars a page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });

      const res = await app.request(`/api/stars/page/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).deleted).toBe(true);
    });

    it('does not accept the legacy page-only route', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      await app.request('/api/stars', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ entityType: 'page', entityId: page.id }),
      });

      const res = await app.request(`/api/stars/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(404);
      const listRes = await app.request('/api/stars', {
        headers: { Cookie: session.Cookie },
      });
      const body = (await listRes.json()) as { stars: Array<Record<string, unknown>> };
      expect(body.stars).toContainEqual(
        expect.objectContaining({ entityType: 'page', entityId: page.id }),
      );
    });
  });
});
