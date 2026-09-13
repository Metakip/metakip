import { MAX_PAGE_TITLE_LENGTH } from '@metakip/shared';
import { describe, expect, it } from 'vitest';
import {
  createTestApp,
  createTestPage,
  createTestSession,
  createTestUser,
  createTestVersion,
} from '../test-utils';

describe('versions API', () => {
  describe('auth guard', () => {
    it('returns 401 without session cookie', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/pages/some-page-id/versions');
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid session token', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/pages/some-page-id/versions', {
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/pages/:pageId/versions', () => {
    it('lists versions for a page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);
      await createTestVersion(page.id, user.id, { title: 'v1' });

      const res = await app.request(`/api/pages/${page.id}/versions`, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0].title).toBe('v1');
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages/00000000-0000-0000-0000-000000000000/versions', {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/pages/:pageId/versions', () => {
    it('creates a version snapshot', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ title: 'Snapshot' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('Snapshot');
    });

    it('returns 400 when title is missing', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}/versions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('normalizes blank titles and rejects titles above the page limit', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const blankRes = await app.request(`/api/pages/${page.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: '   ' }),
      });
      expect(blankRes.status).toBe(200);
      expect(await blankRes.json()).toMatchObject({ title: 'Untitled' });

      const oversizedRes = await app.request(`/api/pages/${page.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: 'x'.repeat(MAX_PAGE_TITLE_LENGTH + 1) }),
      });
      expect(oversizedRes.status).toBe(400);
      expect(await oversizedRes.json()).toMatchObject({
        message: `Title must be ${MAX_PAGE_TITLE_LENGTH} characters or fewer`,
      });
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages/00000000-0000-0000-0000-000000000000/versions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ title: 'v1' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/pages/:pageId/versions/:versionId/restore', () => {
    it('restores a page to a previous version', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'Original' });
      const version = await createTestVersion(page.id, user.id, { title: 'Restored Title' });

      const res = await app.request(`/api/pages/${page.id}/versions/${version.id}/restore`, {
        method: 'POST',
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('Restored Title');
    });

    it('returns 404 for non-existent version', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(
        `/api/pages/${page.id}/versions/00000000-0000-0000-0000-000000000000/restore`,
        {
          method: 'POST',
          headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
        },
      );

      expect(res.status).toBe(404);
    });

    it('normalizes a legacy blank version title when restoring', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'Original' });
      const version = await createTestVersion(page.id, user.id, { title: '   ' });

      const res = await app.request(`/api/pages/${page.id}/versions/${version.id}/restore`, {
        method: 'POST',
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ title: 'Untitled' });
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request(
        '/api/pages/00000000-0000-0000-0000-000000000000/versions/00000000-0000-0000-0000-000000000000/restore',
        {
          method: 'POST',
          headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
        },
      );

      expect(res.status).toBe(404);
    });
  });
});
