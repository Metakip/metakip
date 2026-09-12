import { MAX_PAGE_TITLE_LENGTH } from '@markdawn/shared';
import { markdownToYjsState } from '@markdawn/shared/markdown-yjs';
import { extractConnectionsFromYDoc } from '@markdawn/shared/yjs-helpers';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
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
  createTestWorkspaceMember,
} from '../test-utils';
import { lockWorkspaceAccessMutation } from '../utils/share-access';

async function readWorkspaceAccessVersion(workspaceOwnerId: string): Promise<string> {
  const result = await query<{ version: string }>(
    `select coalesce((
       select version::text from workspace_access_versions where workspace_owner_id = $1
     ), '0') as version`,
    [workspaceOwnerId],
  );
  return result.rows[0]?.version ?? '0';
}

async function waitForWorkspaceLockWaiter(blockerPid: number, minimumCount = 1): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await query<{ count: string }>(
      `select count(*)::text as count
       from pg_stat_activity
       where $1 = any(pg_blocking_pids(pid))`,
      [blockerPid],
    );
    if (Number(result.rows[0]?.count ?? 0) >= minimumCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for page restore to reach the workspace lock');
}

const PRIVATE_PAGE_DETAIL_FIELDS = [
  'parentId',
  'parent_id',
  'createdBy',
  'created_by',
  'ownerId',
  'owner_id',
  'isDeleted',
  'is_deleted',
  'deletedAt',
  'deleted_at',
  'position',
  'createdAt',
  'created_at',
  'inheritancePolicy',
  'inheritance_policy',
  'ydoc',
] as const;

function expectFieldsAbsent(value: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    expect(Object.hasOwn(value, field), `expected ${field} to be absent`).toBe(false);
  }
}

function guestCookie(id = crypto.randomUUID()): string {
  return `markdawn_anon_id=${id}`;
}

function createBoundWikiLinkYdoc(targetId: string, label = ''): Buffer {
  return Buffer.from(markdownToYjsState(`[[id:${targetId}${label ? `|${label}` : ''}]]`));
}

type ShareEventNotification = {
  type: 'share_event';
  action: string;
  entityType: 'page' | 'folder';
  entityId: string;
  targetUserId?: string;
  metaUserIds?: string[];
  metaOnly?: boolean;
};

async function flushShareEventNotifications(payloads: string[]): Promise<ShareEventNotification[]> {
  const marker = `test-notification-marker:${crypto.randomUUID()}`;
  await query("select pg_notify('share_event', $1)", [marker]);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const markerIndex = payloads.indexOf(marker);
    if (markerIndex >= 0) {
      const batch = payloads.splice(0, markerIndex + 1).slice(0, -1);
      return batch.flatMap((payload) => {
        try {
          const parsed = JSON.parse(payload) as Partial<ShareEventNotification>;
          return parsed.type === 'share_event' && parsed.entityId
            ? [parsed as ShareEventNotification]
            : [];
        } catch {
          return [];
        }
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out flushing share event notifications');
}

async function addFolderGrant(folderId: string, recipientUserId: string, permission = 'view') {
  await query(
    `INSERT INTO shares (entity_type, entity_id, recipient_user_id, permission)
     VALUES ('folder', $1, $2, $3)`,
    [folderId, recipientUserId, permission],
  );
}

describe('pages API', () => {
  describe('auth guard', () => {
    it('returns 401 without session cookie', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/pages/tree');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 with invalid session token', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/pages/tree', {
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/pages', () => {
    it('creates a page with valid data', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          title: 'My Test Page',
        }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      const body = await res.json();
      expect(body.title).toBe('My Test Page');
      expect(body.id).toBeTruthy();
      expect(body.ownerId).toBe(user.id);
      expect(body.createdAt).toBeTruthy();
      expect(body.updatedAt).toBeTruthy();
    });

    it('rejects a title that the collaboration server would refuse', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: 'x'.repeat(MAX_PAGE_TITLE_LENGTH + 1) }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        message: `Title must be ${MAX_PAGE_TITLE_LENGTH} characters or fewer`,
      });
      const stored = await query<{ count: string }>(
        'select count(*)::text as count from pages where created_by = $1',
        [user.id],
      );
      expect(stored.rows[0]?.count).toBe('0');
    });

    it('accepts 250 astral characters and rejects the 251st', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const boundaryTitle = '📚'.repeat(MAX_PAGE_TITLE_LENGTH);

      const accepted = await app.request('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: boundaryTitle }),
      });
      expect(accepted.status).toBe(201);
      expect((await accepted.json()) as { title: string }).toMatchObject({ title: boundaryTitle });

      const rejected = await app.request('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: `${boundaryTitle}📚` }),
      });
      expect(rejected.status).toBe(400);
    });

    it('rejects oversized creation bodies before parsing them', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: 'x'.repeat(70 * 1024) }),
      });

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ message: 'Request body is too large' });
    });

    it('creates after a sibling with a position beyond JavaScript safe numeric formatting', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const existing = await createTestPage(user.id);
      await query('update pages set position = $1 where id = $2', [
        '1000000000000000000000',
        existing.id,
      ]);

      const res = await app.request('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: 'After large position' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.position).toBe('1000000000000000000001');
    });

    it('returns 404 for non-existent parentId', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          title: 'Orphan Page',
          parentId: '00000000-0000-0000-0000-000000000000',
        }),
      });
      expect(res.status).toBe(404);
    });

    it('lets an invited editor create inside a shared folder', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const editor = await createTestUser();
      const session = await createTestSession(editor.id);
      const folder = await createTestFolder(owner.id);
      await addFolderGrant(folder.id, editor.id, 'edit');

      const res = await app.request('/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: 'Editor child', parentId: folder.id }),
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ title: 'Editor child', parentId: folder.id });
    });

    it('denies guest page creation inside a publicly editable folder', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const folder = await createTestFolder(owner.id);
      const guestId = '11111111-1111-4111-8111-111111111111';
      await query("update folders set public_permission = 'edit' where id = $1", [folder.id]);

      const res = await app.request('/api/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `markdawn_anon_id=${guestId}`,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ title: 'Guest child', parentId: folder.id }),
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        message: 'Guest editors cannot create or copy pages or folders',
      });
    });

    it('does not let a guest create a page inside a public View folder', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const folder = await createTestFolder(owner.id);
      await query("update folders set public_permission = 'view' where id = $1", [folder.id]);

      const res = await app.request('/api/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'markdawn_anon_id=22222222-2222-4222-8222-222222222222',
        },
        body: JSON.stringify({ parentId: folder.id }),
      });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/pages/tree', () => {
    it('returns pages for the user', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      await createTestPage(user.id, { title: 'Page 1' });
      await createTestPage(user.id, { title: 'Page 2' });

      const res = await app.request(`/api/pages/tree`, {
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
      expect(body.map((p: { title: string }) => p.title).sort()).toEqual(['Page 1', 'Page 2']);
      expect(body[0]).toHaveProperty('id');
    });

    it("includes root workspace owner's pages for workspace members", async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const member = await createTestUser();
      const session = await createTestSession(member.id);
      const page = await createTestPage(owner.id, { title: 'Workspace Root Page' });
      await createTestWorkspaceMember(owner.id, member.id, 'viewer');

      const res = await app.request('/api/pages/tree', {
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      const workspacePage = body.find((p: { id: string }) => p.id === page.id);
      expect(workspacePage).toMatchObject({ workspaceAccess: true, userPermission: 'view' });
    });

    it('includes pages under directly shared folders for folder share recipients', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const session = await createTestSession(recipient.id);
      const folder = await createTestFolder(owner.id, { name: 'Shared Folder' });
      const page = await createTestPage(owner.id, {
        title: 'Page in Shared Folder',
        parentId: folder.id,
      });
      await addFolderGrant(folder.id, recipient.id, 'view');

      const res = await app.request('/api/pages/tree', {
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.some((p: { id: string }) => p.id === page.id)).toBe(true);
    });

    it('includes pages under inherited shared folders for folder share recipients', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const session = await createTestSession(recipient.id);
      const parentFolder = await createTestFolder(owner.id, { name: 'Shared Parent' });
      const childFolder = await createTestFolder(owner.id, {
        name: 'Shared Child',
        parentId: parentFolder.id,
      });
      const page = await createTestPage(owner.id, {
        title: 'Page Under Shared Ancestor',
        parentId: childFolder.id,
      });
      await addFolderGrant(parentFolder.id, recipient.id, 'view');

      const res = await app.request('/api/pages/tree', {
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.some((p: { id: string }) => p.id === page.id)).toBe(true);
    });

    it('still includes pages directly in a non-restricted shared folder', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const session = await createTestSession(recipient.id);
      const folder = await createTestFolder(owner.id, { name: 'Shared Folder' });
      const page = await createTestPage(owner.id, {
        title: 'Page in Shared Folder',
        parentId: folder.id,
      });
      await addFolderGrant(folder.id, recipient.id, 'view');

      const res = await app.request('/api/pages/tree', {
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.some((p: { id: string }) => p.id === page.id)).toBe(true);
    });

    it('does not enumerate independently public pages behind a visited folder boundary', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const visitor = await createTestUser();
      const session = await createTestSession(visitor.id);
      const root = await createTestFolder(owner.id, { name: 'Visited public root' });
      const restrictedChild = await createTestFolder(owner.id, {
        name: 'Restricted public child',
        parentId: root.id,
      });
      const independentPage = await createTestPage(owner.id, {
        title: 'Independent public page',
        parentId: restrictedChild.id,
      });
      await query("update folders set public_permission = 'view' where id = $1", [root.id]);
      await query("update folders set inheritance_policy = 'restricted' where id = $1", [
        restrictedChild.id,
      ]);
      await query("update pages set public_permission = 'view' where id = $1", [
        independentPage.id,
      ]);

      const rootVisit = await app.request(`/api/folders/${root.id}`, {
        headers: { Cookie: session.Cookie },
      });
      expect(rootVisit.status).toBe(200);

      const beforePageVisit = await app.request('/api/pages/tree', {
        headers: { Cookie: session.Cookie },
      });
      expect(beforePageVisit.status).toBe(200);
      expect(
        ((await beforePageVisit.json()) as Array<{ id: string }>).some(
          (page) => page.id === independentPage.id,
        ),
      ).toBe(false);

      const pageVisit = await app.request(`/api/pages/${independentPage.id}`, {
        headers: { Cookie: session.Cookie },
      });
      expect(pageVisit.status).toBe(200);

      const afterPageVisit = await app.request('/api/pages/tree', {
        headers: { Cookie: session.Cookie },
      });
      expect(afterPageVisit.status).toBe(200);
      expect(
        ((await afterPageVisit.json()) as Array<{ id: string }>).some(
          (page) => page.id === independentPage.id,
        ),
      ).toBe(true);
    });
  });

  describe('GET /api/pages/trash', () => {
    it('lists trashed pages for the user', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'To Delete' });

      await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      const res = await app.request('/api/pages/trash', {
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.some((p: { id: string }) => p.id === page.id)).toBe(true);
    });

    it('uses folder owner, not creator, for child page trash control', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const collaborator = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const collaboratorSession = await createTestSession(collaborator.id);
      const folder = await createTestFolder(owner.id, { name: 'Owner Folder' });
      const page = await createTestPage(collaborator.id, {
        title: 'Collaborator Child',
        parentId: folder.id,
      });

      const deleteRes = await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: ownerSession.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(deleteRes.status).toBe(200);

      const ownerTrashRes = await app.request('/api/pages/trash', {
        headers: { Cookie: ownerSession.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(ownerTrashRes.status).toBe(200);
      const ownerTrash = (await ownerTrashRes.json()) as Array<{
        id: string;
        ownerId: string | null;
      }>;
      expect(ownerTrash).toContainEqual(
        expect.objectContaining({ id: page.id, ownerId: owner.id }),
      );

      const collaboratorTrashRes = await app.request('/api/pages/trash', {
        headers: { Cookie: collaboratorSession.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(collaboratorTrashRes.status).toBe(200);
      const collaboratorTrash = (await collaboratorTrashRes.json()) as Array<{ id: string }>;
      expect(collaboratorTrash).not.toContainEqual(expect.objectContaining({ id: page.id }));

      const collaboratorRestoreRes = await app.request(`/api/pages/${page.id}/restore`, {
        method: 'PATCH',
        headers: { Cookie: collaboratorSession.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(collaboratorRestoreRes.status).toBe(403);

      const ownerRestoreRes = await app.request(`/api/pages/${page.id}/restore`, {
        method: 'PATCH',
        headers: { Cookie: ownerSession.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(ownerRestoreRes.status).toBe(200);

      await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: ownerSession.Cookie, Origin: 'http://localhost:5173' },
      });
      const permanentRes = await app.request(`/api/pages/${page.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: ownerSession.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(permanentRes.status).toBe(200);

      const pageRows = await query('select id from pages where id = $1', [page.id]);
      expect(pageRows.rowCount).toBe(0);
    });

    it('rechecks ownership after a concurrent parent workspace change', async () => {
      const app = await createTestApp();
      const originalOwner = await createTestUser();
      const otherOwner = await createTestUser();
      const session = await createTestSession(originalOwner.id);
      const originalRoot = await createTestFolder(originalOwner.id, { name: 'Original root' });
      const otherRoot = await createTestFolder(otherOwner.id, { name: 'Other root' });
      const page = await createTestPage(originalOwner.id, {
        title: 'Deleted child',
        parentId: originalRoot.id,
      });
      const deleteRes = await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(deleteRes.status).toBe(200);

      let releaseBlocker = (): void => undefined;
      let reportBlockerPid = (_pid: number): void => undefined;
      const blockerReleased = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      const blockerReady = new Promise<number>((resolve) => {
        reportBlockerPid = resolve;
      });
      const blocker = db.transaction(async (tx) => {
        await lockWorkspaceAccessMutation(tx, originalOwner.id);
        const pidResult = await executeQuery<{ pid: number }>(
          tx,
          sql.raw('select pg_backend_pid() as pid'),
        );
        const pid = pidResult.rows[0]?.pid;
        if (!pid) throw new Error('Failed to resolve page restore blocker PID');
        reportBlockerPid(pid);
        await blockerReleased;
      });

      const blockerPid = await blockerReady;
      const restorePromise = app.request(`/api/pages/${page.id}/restore`, {
        method: 'PATCH',
        headers: { Cookie: session.Cookie },
      });
      let orchestrationError: unknown = null;
      try {
        await waitForWorkspaceLockWaiter(blockerPid);
        await query('update folders set parent_id = $1 where id = $2', [
          otherRoot.id,
          originalRoot.id,
        ]);
      } catch (error) {
        orchestrationError = error;
      } finally {
        releaseBlocker();
        await blocker;
      }
      const restoreRes = await restorePromise;
      if (orchestrationError) throw orchestrationError;

      expect(restoreRes.status).toBe(403);
      expect(await restoreRes.json()).toMatchObject({
        message: 'You can only restore pages that you own',
      });
      const stored = await query<{ is_deleted: boolean }>(
        'select is_deleted from pages where id = $1',
        [page.id],
      );
      expect(stored.rows[0]?.is_deleted).toBe(true);
    });
  });

  describe('DELETE /api/pages/trash/empty-all', () => {
    it('empties all trashed pages', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);
      await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      const res = await app.request('/api/pages/trash/empty-all', {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(true);
      expect(body.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/pages/:id/access', () => {
    it('records a signed-in public visit without token provenance', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const visitor = await createTestUser();
      const visitorSession = await createTestSession(visitor.id);
      const page = await createTestPage(owner.id, { title: 'Public visit' });
      await query("update pages set public_permission = 'view' where id = $1", [page.id]);

      const response = await app.request(`/api/pages/${page.id}/access`, {
        method: 'POST',
        headers: { Cookie: visitorSession.Cookie },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      const visits = await query<{ count: string }>(
        'select count(*)::text as count from page_public_access_visits where page_id = $1 and user_id = $2',
        [page.id, visitor.id],
      );
      expect(visits.rows[0]?.count).toBe('1');
    });

    it('preserves a public visit after a stronger account grant is revoked', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const recipientSession = await createTestSession(recipient.id);
      const page = await createTestPage(owner.id, { title: 'Public fallback' });
      await query("update pages set public_permission = 'view' where id = $1", [page.id]);
      const grant = await query<{ id: string }>(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'edit') returning id`,
        [page.id, owner.id, recipient.id],
      );

      await app.request(`/api/pages/${page.id}/access`, {
        method: 'POST',
        headers: { Cookie: recipientSession.Cookie },
      });
      const revoke = await app.request(`/api/shares/grants/${grant.rows[0]?.id}`, {
        method: 'DELETE',
        headers: { Cookie: ownerSession.Cookie },
      });
      expect(revoke.status).toBe(200);
      const withMe = await app.request('/api/shares/with-me', {
        headers: { Cookie: recipientSession.Cookie },
      });
      expect(await withMe.json()).toEqual([
        expect.objectContaining({ entityId: page.id, source: 'public' }),
      ]);
    });
  });

  describe('GET /api/pages/export', () => {
    it('exports accessible pages from the mounted route', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      await createTestPage(user.id, { title: 'Exported Page' });

      const res = await app.request('/api/pages/export', {
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('application/zip');
      expect(res.headers.get('Content-Disposition')).toContain('markdawn-export.zip');
    });
  });

  describe('GET /api/pages/recent', () => {
    it('returns recent pages for the user', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      await app.request(`/api/pages/${page.id}`, {
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      const res = await app.request('/api/pages/recent', {
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('returns 400 for non-positive limit', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages/recent?limit=0', {
        headers: { Cookie: session.Cookie },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('wiki-link target resolution', () => {
    it('returns the current title for the exact selected duplicate after a rename', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const session = await createTestSession(owner.id);
      const source = await createTestPage(owner.id, { title: 'Source page' });
      await createTestPage(owner.id, { title: 'Duplicate title' });
      const selected = await createTestPage(owner.id, { title: 'Duplicate title' });

      const resolveSelected = await app.request(`/api/pages/${source.id}/wiki-link-presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({
          links: [{ key: 'selected', targetId: selected.id }],
        }),
      });
      expect(resolveSelected.status).toBe(200);
      expect(await resolveSelected.json()).toEqual({
        links: [
          {
            key: 'selected',
            state: 'accessible',
            target: { id: selected.id, title: 'Duplicate title' },
          },
        ],
      });

      await query('update pages set title = $1 where id = $2', ['Renamed target', selected.id]);
      const resolveRenamed = await app.request(`/api/pages/${source.id}/wiki-link-presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ links: [{ key: 'selected', targetId: selected.id }] }),
      });
      expect(resolveRenamed.status).toBe(200);
      expect(await resolveRenamed.json()).toEqual({
        links: [
          {
            key: 'selected',
            state: 'accessible',
            target: { id: selected.id, title: 'Renamed target' },
          },
        ],
      });
    });

    it('returns only a restricted state when the requester cannot access the target', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const editor = await createTestUser();
      const session = await createTestSession(editor.id);
      const source = await createTestPage(owner.id, { title: 'Shared source' });
      const hiddenTarget = await createTestPage(owner.id, { title: 'Hidden target' });
      await query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'edit')`,
        [source.id, owner.id, editor.id],
      );

      const response = await app.request(`/api/pages/${source.id}/wiki-link-presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ links: [{ key: 'hidden', targetId: hiddenTarget.id }] }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        links: [{ key: 'hidden', state: 'restricted' }],
      });
    });

    it('automatically resolves only unique normalized authored paths', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const session = await createTestSession(owner.id);
      const source = await createTestPage(owner.id, { title: 'Source' });
      const target = await createTestPage(owner.id, { title: 'Roadmap' });

      const response = await app.request(`/api/pages/${source.id}/wiki-link-presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({
          links: [
            { key: 'markdown', path: '/Roadmap.md#Plan' },
            { key: 'missing', path: 'Missing' },
          ],
        }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        links: [
          {
            key: 'markdown',
            state: 'accessible',
            target: { id: target.id, title: 'Roadmap' },
          },
          { key: 'missing', state: 'unavailable' },
        ],
      });
    });

    it('resolves a heading-only link against its source page', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const session = await createTestSession(owner.id);
      const source = await createTestPage(owner.id, { title: 'Source page' });

      const response = await app.request(`/api/pages/${source.id}/wiki-link-presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ links: [{ key: 'heading', path: '#Overview' }] }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        links: [
          {
            key: 'heading',
            state: 'accessible',
            target: { id: source.id, title: 'Source page' },
          },
        ],
      });
    });

    it('leaves ambiguous authored titles unavailable instead of guessing', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const session = await createTestSession(owner.id);
      const source = await createTestPage(owner.id, { title: 'Source' });
      await createTestPage(owner.id, { title: 'Duplicate' });
      await createTestPage(owner.id, { title: 'Duplicate' });

      const response = await app.request(`/api/pages/${source.id}/wiki-link-presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ links: [{ key: 'ambiguous', path: 'Duplicate' }] }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        links: [{ key: 'ambiguous', state: 'unavailable' }],
      });
    });

    it('shows signed-out readers the same restricted state without target metadata', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const source = await createTestPage(owner.id, { title: 'Public source' });
      const hiddenTarget = await createTestPage(owner.id, { title: 'Private target' });
      await query("update pages set public_permission = 'view' where id = $1", [source.id]);

      const response = await app.request(`/api/pages/${source.id}/wiki-link-presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: guestCookie() },
        body: JSON.stringify({ links: [{ key: 'hidden', targetId: hiddenTarget.id }] }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        links: [{ key: 'hidden', state: 'restricted' }],
      });
    });

    it('updates a signed-out presentation when public target access is revoked', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const source = await createTestPage(owner.id, { title: 'Public source' });
      const target = await createTestPage(owner.id, { title: 'Public target' });
      await query("update pages set public_permission = 'view' where id = any($1::uuid[])", [
        [source.id, target.id],
      ]);
      const cookie = guestCookie();
      const requestPresentation = () =>
        app.request(`/api/pages/${source.id}/wiki-link-presentations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ links: [{ key: 'target', targetId: target.id }] }),
        });

      const accessible = await requestPresentation();
      expect(await accessible.json()).toEqual({
        links: [
          {
            key: 'target',
            state: 'accessible',
            target: { id: target.id, title: 'Public target' },
          },
        ],
      });

      await query('update pages set public_permission = null where id = $1', [target.id]);
      const restricted = await requestPresentation();
      expect(await restricted.json()).toEqual({
        links: [{ key: 'target', state: 'restricted' }],
      });
    });

    it('marks a deleted bound target unavailable without retaining its title', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const session = await createTestSession(owner.id);
      const source = await createTestPage(owner.id, { title: 'Source' });
      const target = await createTestPage(owner.id, { title: 'Deleted target' });
      await query('update pages set is_deleted = true, deleted_at = now() where id = $1', [
        target.id,
      ]);

      const response = await app.request(`/api/pages/${source.id}/wiki-link-presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ links: [{ key: 'target', targetId: target.id }] }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        links: [{ key: 'target', state: 'unavailable' }],
      });
    });

    it('does not recreate a ghost connection through the removed binding endpoint', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const session = await createTestSession(owner.id);
      const source = await createTestPage(owner.id, { title: 'Source' });
      const target = await createTestPage(owner.id, { title: 'Target' });

      const response = await app.request(`/api/pages/${source.id}/wiki-link-target`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ path: 'Target', targetId: target.id }),
      });
      expect(response.status).toBe(404);
      const stored = await query<{ count: string }>(
        `select count(*)::text as count from connections
         where source_type = 'page' and source_id = $1 and target_id = $2`,
        [source.id, target.id],
      );
      expect(stored.rows[0]?.count).toBe('0');
    });

    it('returns 413 for an oversized streamed presentation request', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const session = await createTestSession(owner.id);
      const source = await createTestPage(owner.id, { title: 'Source' });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ links: [], padding: 'x'.repeat(300_000) })),
          );
          controller.close();
        },
      });
      const request = new Request(
        `http://localhost/api/pages/${source.id}/wiki-link-presentations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
          body: stream,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' },
      );

      const response = await app.request(request);
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ message: 'Request body is too large' });
    });
  });

  it('does not expose the unfinished comments API', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);
    const page = await createTestPage(owner.id);

    for (const method of ['GET', 'POST'] as const) {
      const response = await app.request(`/api/pages/${page.id}/comments`, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        ...(method === 'POST' ? { body: JSON.stringify({ content: 'Not available' }) } : {}),
      });
      expect(response.status).toBe(404);
    }
  });

  describe('GET /api/pages/:id public access', () => {
    it('allows anonymous access through public ancestor folder access', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const folder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, {
        parentId: folder.id,
        title: 'Inherited Public Page',
      });
      await query("update folders set public_permission = 'view' where id = $1", [folder.id]);

      const response = await app.request(`/api/pages/${page.id}`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.title).toBe('Inherited Public Page');
      expect(body.publicPermission).toBe('view');
      expectFieldsAbsent(body as Record<string, unknown>, PRIVATE_PAGE_DETAIL_FIELDS);
    });

    it('returns the minimal DTO to a signed-in public visitor without bumping revisions', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const visitor = await createTestUser();
      const visitorSession = await createTestSession(visitor.id);
      const page = await createTestPage(owner.id, { title: 'Signed public page' });
      await query("update pages set public_permission = 'view' where id = $1", [page.id]);
      const readVersion = async (): Promise<string> => {
        const version = await query<{ version: string }>(
          `select coalesce((
             select version::text from workspace_access_versions where workspace_owner_id = $1
           ), '0') as version`,
          [owner.id],
        );
        return version.rows[0]?.version ?? '0';
      };
      const before = await readVersion();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await app.request(`/api/pages/${page.id}`, {
          headers: { Cookie: visitorSession.Cookie },
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as Record<string, unknown>;
        expect(body).toMatchObject({
          accessScope: 'public',
          id: page.id,
          title: 'Signed public page',
        });
        expectFieldsAbsent(body, PRIVATE_PAGE_DETAIL_FIELDS);
      }
      expect(await readVersion()).toBe(before);
    });

    it('returns an explicit authenticated DTO to an account-source viewer', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const viewer = await createTestUser();
      const viewerSession = await createTestSession(viewer.id);
      const page = await createTestPage(owner.id, { title: 'Account-source page' });
      await query("update pages set public_permission = 'edit' where id = $1", [page.id]);
      await query(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, viewer.id],
      );

      const response = await app.request(`/api/pages/${page.id}`, {
        headers: { Cookie: viewerSession.Cookie },
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        accessScope: 'account',
        id: page.id,
        createdBy: owner.id,
        ownerId: owner.id,
        userPermission: 'edit',
      });
      expectFieldsAbsent(body, [
        'created_by',
        'owner_id',
        'isDeleted',
        'is_deleted',
        'deletedAt',
        'deleted_at',
        'ydoc',
      ]);
    });
  });

  describe('PATCH /api/pages/:id/metadata public access', () => {
    it('forbids guest icon and cover updates', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const parent = await createTestFolder(owner.id, { name: 'Private parent details' });
      const page = await createTestPage(owner.id, {
        parentId: parent.id,
        title: 'Guest metadata page',
      });
      await query("update pages set public_permission = 'edit' where id = $1", [page.id]);

      const response = await app.request(`/api/pages/${page.id}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: guestCookie() },
        body: JSON.stringify({
          icon: 'G',
          coverType: 'color',
          coverValue: 'blue',
          properties: { status: 'public' },
        }),
      });

      expect(response.status).toBe(403);
    });

    it('updates the tag connection index for a guest editor', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const page = await createTestPage(owner.id, { title: 'Guest tag page' });
      await query("update pages set public_permission = 'edit' where id = $1", [page.id]);

      const response = await app.request(`/api/pages/${page.id}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: guestCookie() },
        body: JSON.stringify({ properties: { tags: ['Public tag'] } }),
      });

      expect(response.status).toBe(200);
      const indexed = await query<{ target_slug: string }>(
        `select target_slug from connections
         where source_type = 'page' and source_id = $1 and connection_type = 'tag'`,
        [page.id],
      );
      expect(indexed.rows).toEqual([{ target_slug: '#public tag' }]);
    });
  });

  describe('PATCH /api/pages/:id/title public access', () => {
    it('renames a page through anonymous public Edit access', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const page = await createTestPage(owner.id, { title: 'Original title' });
      await query("update pages set public_permission = 'edit' where id = $1", [page.id]);
      const revisionBefore = await readWorkspaceAccessVersion(owner.id);

      const res = await app.request(`/api/pages/${page.id}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: guestCookie() },
        body: JSON.stringify({ title: 'Anonymous title' }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ title: 'Anonymous title' });
      const stored = await query<{ title: string }>('select title from pages where id = $1', [
        page.id,
      ]);
      expect(stored.rows[0]?.title).toBe('Anonymous title');
      expect(await readWorkspaceAccessVersion(owner.id)).toBe(revisionBefore);
    });

    it('rechecks public Edit access after waiting for the workspace access lock', async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) throw new Error('DATABASE_URL is required');

      const app = await createTestApp();
      const owner = await createTestUser();
      const page = await createTestPage(owner.id, { title: 'Before revocation' });
      await query("update pages set public_permission = 'edit' where id = $1", [page.id]);

      const blocker = new Client({ connectionString });
      let blockerTransactionOpen = false;
      let titlePromise: Promise<Response> | null = null;
      await blocker.connect();

      try {
        await blocker.query('begin');
        blockerTransactionOpen = true;
        const blockerPidResult = await blocker.query<{ pid: number }>(
          'select pg_backend_pid() as pid',
        );
        const blockerPid = blockerPidResult.rows[0]?.pid;
        if (blockerPid === undefined) throw new Error('Could not resolve page access blocker PID');
        await blocker.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `workspace-access:${owner.id}`,
        ]);

        const pendingTitle = Promise.resolve(
          app.request(`/api/pages/${page.id}/title`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Cookie: guestCookie() },
            body: JSON.stringify({ title: 'Must not persist' }),
          }),
        );
        titlePromise = pendingTitle;

        await waitForWorkspaceLockWaiter(blockerPid);
        await blocker.query('update pages set public_permission = null where id = $1', [page.id]);
        await blocker.query('commit');
        blockerTransactionOpen = false;

        const response = await pendingTitle;
        expect(response.status).toBe(404);
        const stored = await query<{ title: string }>('select title from pages where id = $1', [
          page.id,
        ]);
        expect(stored.rows[0]?.title).toBe('Before revocation');
      } finally {
        if (blockerTransactionOpen) await blocker.query('rollback');
        await blocker.end();
        if (titlePromise) await Promise.allSettled([titlePromise]);
      }
    });

    it('rejects title changes through public View access', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const page = await createTestPage(owner.id);
      await query("update pages set public_permission = 'view' where id = $1", [page.id]);

      const res = await app.request(`/api/pages/${page.id}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: guestCookie() },
        body: JSON.stringify({ title: 'Not allowed' }),
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ message: 'Forbidden' });
    });

    it('rejects oversized public request bodies before parsing JSON', async () => {
      const app = await createTestApp();

      const res = await app.request('/api/pages/00000000-0000-0000-0000-000000000000/title', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: guestCookie() },
        body: JSON.stringify({ title: 'T'.repeat(5_000) }),
      });

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ message: 'Request body is too large' });
    });

    it('rejects oversized titles through anonymous public Edit access', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const page = await createTestPage(owner.id);
      await query("update pages set public_permission = 'edit' where id = $1", [page.id]);

      const res = await app.request(`/api/pages/${page.id}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: guestCookie() },
        body: JSON.stringify({ title: 'T'.repeat(251) }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: 'Title must be 250 characters or fewer' });
    });

    it('does not reveal private pages through the public title endpoint', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const page = await createTestPage(owner.id);

      const res = await app.request(`/api/pages/${page.id}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: guestCookie() },
        body: JSON.stringify({ title: 'Not allowed' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/pages/:id/restore', () => {
    it('restores a soft-deleted page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      const res = await app.request(`/api/pages/${page.id}/restore`, {
        method: 'PATCH',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
      const _body = await res.json();
      const treeRes = await app.request('/api/pages/tree', {
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      const tree = await treeRes.json();
      expect(tree.some((p: { id: string }) => p.id === page.id)).toBe(true);
    });

    it('preserves an active parent and the original creator', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const creator = await createTestUser();
      const session = await createTestSession(owner.id);
      const folder = await createTestFolder(owner.id);
      const page = await createTestPage(creator.id, { parentId: folder.id });

      const deleteResponse = await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(deleteResponse.status).toBe(200);

      const restoreResponse = await app.request(`/api/pages/${page.id}/restore`, {
        method: 'PATCH',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(restoreResponse.status).toBe(200);

      const restored = await query<{
        parent_id: string | null;
        created_by: string | null;
        is_deleted: boolean;
      }>('SELECT parent_id, created_by, is_deleted FROM pages WHERE id = $1', [page.id]);
      expect(restored.rows[0]).toEqual({
        parent_id: folder.id,
        created_by: creator.id,
        is_deleted: false,
      });
    });

    it('restores a page from a deleted folder to the workspace root', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const collaborator = await createTestUser();
      const session = await createTestSession(owner.id);
      const folder = await createTestFolder(owner.id);
      const page = await createTestPage(collaborator.id, { parentId: folder.id });

      const deleteResponse = await app.request(`/api/folders/${folder.id}?force=true`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(deleteResponse.status).toBe(200);

      const restoreResponse = await app.request(`/api/pages/${page.id}/restore`, {
        method: 'PATCH',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });

      expect(restoreResponse.status).toBe(200);
      const restored = await query<{
        parent_id: string | null;
        created_by: string;
        is_deleted: boolean;
      }>('SELECT parent_id, created_by, is_deleted FROM pages WHERE id = $1', [page.id]);
      expect(restored.rows[0]).toEqual({
        parent_id: null,
        created_by: owner.id,
        is_deleted: false,
      });
      const deletedFolder = await query<{ is_deleted: boolean }>(
        'SELECT is_deleted FROM folders WHERE id = $1',
        [folder.id],
      );
      expect(deletedFolder.rows[0]?.is_deleted).toBe(true);
    });
  });

  describe('PATCH /api/pages/:id/move', () => {
    it('moves a page to a different parent', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'Movable' });

      const res = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ parentId: null, position: 0 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(page.id);
    });

    it('rejects a non-numeric move position without changing the page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ position: 'a0' }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_POSITION' });
      const stored = await query<{ position: string }>('SELECT position FROM pages WHERE id = $1', [
        page.id,
      ]);
      expect(stored.rows[0]?.position).toBe('0');
    });

    it('keeps position-only moves revision-neutral and advances revisions for parent changes', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const session = await createTestSession(owner.id);
      const destination = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id);
      const revisionBefore = await readWorkspaceAccessVersion(owner.id);

      const reorder = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ position: '42' }),
      });
      expect(reorder.status).toBe(200);
      expect(await readWorkspaceAccessVersion(owner.id)).toBe(revisionBefore);

      const move = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ parentId: destination.id, position: '0' }),
      });
      expect(move.status).toBe(200);
      expect(BigInt(await readWorkspaceAccessVersion(owner.id))).toBeGreaterThan(
        BigInt(revisionBefore),
      );
    });

    it('rejects decimal positions that exceed the database precision bound', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);
      const oversizedPosition = `0.${'0'.repeat(128)}1`;

      const res = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ position: oversizedPosition }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_POSITION' });
    });

    it('prevents moving page to itself', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ parentId: page.id }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects moving a shared page into a folder the caller cannot edit', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const collaborator = await createTestUser();
      const otherOwner = await createTestUser();
      const session = await createTestSession(collaborator.id);
      const page = await createTestPage(owner.id);
      const forbiddenFolder = await createTestFolder(otherOwner.id);

      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'edit')`,
        [page.id, owner.id, collaborator.id],
      );

      const res = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ parentId: forbiddenFolder.id }),
      });

      expect(res.status).toBe(403);
    });

    it('does not let editors move pages', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const editor = await createTestUser();
      const session = await createTestSession(editor.id);
      const sourceFolder = await createTestFolder(owner.id);
      const destinationFolder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, { parentId: sourceFolder.id });

      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('folder', $1, $3, $2, 'edit'), ('folder', $4, $3, $2, 'edit')`,
        [sourceFolder.id, editor.id, owner.id, destinationFolder.id],
      );

      const res = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ parentId: destinationFolder.id }),
      });

      expect(res.status).toBe(403);
    });

    it('lets admins move pages between folders owned by the same user', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const admin = await createTestUser();
      const session = await createTestSession(admin.id);
      const sourceFolder = await createTestFolder(owner.id);
      const destinationFolder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, { parentId: sourceFolder.id });

      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('folder', $1, $3, $2, 'admin'), ('folder', $4, $3, $2, 'admin')`,
        [sourceFolder.id, admin.id, owner.id, destinationFolder.id],
      );

      const res = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ parentId: destinationFolder.id }),
      });

      expect(res.status).toBe(200);
    });

    it('blocks moves between different owners even when the caller is admin in both places', async () => {
      const app = await createTestApp();
      const sourceOwner = await createTestUser();
      const destinationOwner = await createTestUser();
      const admin = await createTestUser();
      const session = await createTestSession(admin.id);
      const sourceFolder = await createTestFolder(sourceOwner.id);
      const destinationFolder = await createTestFolder(destinationOwner.id);
      const page = await createTestPage(sourceOwner.id, { parentId: sourceFolder.id });

      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('folder', $1, $3, $2, 'admin'), ('folder', $4, $5, $2, 'admin')`,
        [sourceFolder.id, admin.id, sourceOwner.id, destinationFolder.id, destinationOwner.id],
      );

      const res = await app.request(`/api/pages/${page.id}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ parentId: destinationFolder.id }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/pages/:id/export/markdown', () => {
    it('exports page content as markdown', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const page = await createTestPage(user.id, { title: 'Export' });

      const res = await app.request(`/api/pages/${page.id}/export/markdown`, {
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/markdown');
      expect(res.headers.get('Content-Disposition')).toContain('Export.md');
      const body = await res.text();
      expect(typeof body).toBe('string');
      expect(body).not.toContain('# Export');
    });

    it('allows signed-in viewers to export a shared page', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const viewer = await createTestUser();
      const session = await createTestSession(viewer.id);
      const page = await createTestPage(owner.id, { title: 'Shared Export' });
      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, viewer.id],
      );

      const res = await app.request(`/api/pages/${page.id}/export/markdown`, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
    });

    it('exports current target titles only to requesters who can access them', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const viewer = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const viewerSession = await createTestSession(viewer.id);
      const source = await createTestPage(owner.id, { title: 'Source export' });
      const target = await createTestPage(owner.id, { title: 'Roadmap' });
      await query('update pages set ydoc = $1 where id = $2', [
        createBoundWikiLinkYdoc(target.id, 'Project plan'),
        source.id,
      ]);
      await query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
        [source.id, owner.id, viewer.id],
      );
      await query('update pages set title = $1 where id = $2', ['2026 Roadmap', target.id]);

      const ownerExport = await app.request(`/api/pages/${source.id}/export/markdown`, {
        headers: { Cookie: ownerSession.Cookie },
      });
      expect(ownerExport.status).toBe(200);
      const ownerMarkdown = await ownerExport.text();
      expect(ownerMarkdown).toContain('[[2026 Roadmap|Project plan]]');
      expect(ownerMarkdown).not.toContain(target.id);

      const viewerExport = await app.request(`/api/pages/${source.id}/export/markdown`, {
        headers: { Cookie: viewerSession.Cookie },
      });
      expect(viewerExport.status).toBe(200);
      const viewerMarkdown = await viewerExport.text();
      expect(viewerMarkdown).toContain('Restricted page');
      expect(viewerMarkdown).not.toContain('2026 Roadmap');
      expect(viewerMarkdown).not.toContain('Project plan');
      expect(viewerMarkdown).not.toContain(target.id);
    });

    it('orders a queued revoke before a later export authorization snapshot', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const viewer = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const viewerSession = await createTestSession(viewer.id);
      const page = await createTestPage(owner.id, { title: 'Revoke export race' });
      const share = await query<{ id: string }>(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('page', $1, $2, $3, 'view')
         returning id`,
        [page.id, owner.id, viewer.id],
      );
      const shareId = share.rows[0]?.id;
      if (!shareId) throw new Error('Failed to create test share');

      let releaseBlocker = (): void => undefined;
      const blockerRelease = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      let signalBlockerReady = (_pid: number): void => undefined;
      const blockerReady = new Promise<number>((resolve) => {
        signalBlockerReady = resolve;
      });
      const blocker = db.transaction(async (tx) => {
        await lockWorkspaceAccessMutation(tx, owner.id);
        const pidResult = await executeQuery<{ pid: number }>(
          tx,
          sql.raw('select pg_backend_pid() as pid'),
        );
        const pid = pidResult.rows[0]?.pid;
        if (pid === undefined) throw new Error('Failed to resolve blocker PID');
        signalBlockerReady(pid);
        await blockerRelease;
      });
      const blockerPid = await blockerReady;
      const revokePromise = app.request(`/api/shares/grants/${shareId}`, {
        method: 'DELETE',
        headers: { Cookie: ownerSession.Cookie },
      });
      let exportPromise: Promise<Response> | null = null;

      try {
        await waitForWorkspaceLockWaiter(blockerPid);
        const queuedExport = Promise.resolve(
          app.request(`/api/pages/${page.id}/export/markdown`, {
            headers: { Cookie: viewerSession.Cookie },
          }),
        );
        exportPromise = queuedExport;
        await waitForWorkspaceLockWaiter(blockerPid, 2);
        releaseBlocker();

        const revokeResponse = await revokePromise;
        const exportResponse = await queuedExport;
        expect(revokeResponse.status).toBe(200);
        expect(exportResponse.status).toBe(403);
      } finally {
        releaseBlocker();
        await blocker;
        await Promise.allSettled([revokePromise, ...(exportPromise ? [exportPromise] : [])]);
      }
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request(
        '/api/pages/00000000-0000-0000-0000-000000000000/export/markdown',
        {
          headers: { Cookie: session.Cookie },
        },
      );
      expect(res.status).toBe(404);
    });

    it('rejects oversized copy bodies before resolving the page or destination', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const response = await app.request('/api/pages/00000000-0000-0000-0000-000000000000/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ padding: 'x'.repeat(5 * 1024) }),
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ message: 'Request body is too large' });
    });
  });

  describe('POST /api/pages/:id/import/markdown', () => {
    it('imports markdown via JSON body', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'Import' });
      const revisionBefore = await readWorkspaceAccessVersion(user.id);

      const res = await app.request(`/api/pages/${page.id}/import/markdown`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ markdown: '# New Content\n\nHello world' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(await readWorkspaceAccessVersion(user.id)).toBe(revisionBefore);
    });

    it('binds only the exact target visible to a public-access importer', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const importer = await createTestUser();
      const session = await createTestSession(importer.id);
      const destination = await createTestPage(owner.id, { title: 'Public import target' });
      const visibleTarget = await createTestPage(owner.id, { title: 'Visible reference' });
      const hiddenTarget = await createTestPage(owner.id, { title: 'Private reference' });
      const hiddenDuplicate = await createTestPage(owner.id, { title: 'Visible reference' });
      await query("update pages set public_permission = 'edit' where id = $1", [destination.id]);
      await query(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('page', $1, $2, $3, 'view')`,
        [visibleTarget.id, owner.id, importer.id],
      );

      const res = await app.request(`/api/pages/${destination.id}/import/markdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({
          markdown: 'See [[Visible reference]] and [[Private reference]]',
        }),
      });

      expect(res.status).toBe(200);
      const stored = await query<{ ydoc: Buffer }>('select ydoc from pages where id = $1', [
        destination.id,
      ]);
      const connections = extractConnectionsFromYDoc(new Uint8Array(stored.rows[0]?.ydoc ?? []));
      expect(connections).toContainEqual(
        expect.objectContaining({
          targetSlug: `id:${visibleTarget.id}`,
          targetId: visibleTarget.id,
        }),
      );
      expect(
        connections.find((connection) => connection.targetSlug === 'private reference')?.targetId,
      ).toBeUndefined();
      expect(connections.some((connection) => connection.targetId === hiddenTarget.id)).toBe(false);
      expect(connections.some((connection) => connection.targetId === hiddenDuplicate.id)).toBe(
        false,
      );
      expect(stored.rows[0]?.ydoc.includes(Buffer.from(visibleTarget.id))).toBe(true);
      expect(stored.rows[0]?.ydoc.includes(Buffer.from('Visible reference'))).toBe(false);
      const occurrences = await query<{ context: string | null }>(
        `select co.context
         from connection_occurrences co
         join connections c on c.id = co.connection_id
         where c.source_id = $1 and c.target_id = $2`,
        [destination.id, visibleTarget.id],
      );
      expect(occurrences.rows).toEqual([expect.objectContaining({ context: expect.any(String) })]);
    });

    it('resolves targets after a queued revoke has linearized', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const importer = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const importerSession = await createTestSession(importer.id);
      const destination = await createTestPage(owner.id, { title: 'Serialized import' });
      const target = await createTestPage(owner.id, { title: 'Revoked reference' });
      await query(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('page', $1, $2, $3, 'edit')`,
        [destination.id, owner.id, importer.id],
      );
      const targetShare = await query<{ id: string }>(
        `insert into shares (
           entity_type, entity_id, shared_by, recipient_user_id, permission
         ) values ('page', $1, $2, $3, 'view')
         returning id`,
        [target.id, owner.id, importer.id],
      );
      const targetShareId = targetShare.rows[0]?.id;
      if (!targetShareId) throw new Error('Failed to create target share');

      let releaseBlocker = (): void => undefined;
      const blockerRelease = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      let signalBlockerReady = (_pid: number): void => undefined;
      const blockerReady = new Promise<number>((resolve) => {
        signalBlockerReady = resolve;
      });
      const blocker = db.transaction(async (tx) => {
        await lockWorkspaceAccessMutation(tx, owner.id);
        const pidResult = await executeQuery<{ pid: number }>(
          tx,
          sql.raw('select pg_backend_pid() as pid'),
        );
        const pid = pidResult.rows[0]?.pid;
        if (pid === undefined) throw new Error('Failed to resolve blocker PID');
        signalBlockerReady(pid);
        await blockerRelease;
      });
      const blockerPid = await blockerReady;
      const revokePromise = app.request(`/api/shares/grants/${targetShareId}`, {
        method: 'DELETE',
        headers: { Cookie: ownerSession.Cookie },
      });
      let importPromise: Promise<Response> | null = null;

      try {
        await waitForWorkspaceLockWaiter(blockerPid);
        const queuedImport = Promise.resolve(
          app.request(`/api/pages/${destination.id}/import/markdown`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: importerSession.Cookie },
            body: JSON.stringify({ markdown: 'See [[Revoked reference]]' }),
          }),
        );
        importPromise = queuedImport;
        await waitForWorkspaceLockWaiter(blockerPid, 2);
        releaseBlocker();

        expect((await revokePromise).status).toBe(200);
        expect((await queuedImport).status).toBe(200);
        const stored = await query<{ ydoc: Buffer }>('select ydoc from pages where id = $1', [
          destination.id,
        ]);
        const connections = extractConnectionsFromYDoc(new Uint8Array(stored.rows[0]?.ydoc ?? []));
        expect(
          connections.find((connection) => connection.targetSlug === 'revoked reference')?.targetId,
        ).toBeUndefined();
        expect(connections.some((connection) => connection.targetId === target.id)).toBe(false);
      } finally {
        releaseBlocker();
        await blocker;
        await Promise.allSettled([revokePromise, ...(importPromise ? [importPromise] : [])]);
      }
    });

    it('returns 415 for unsupported content type', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}/import/markdown`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: 'plain text',
      });
      expect(res.status).toBe(415);
    });

    it('returns 400 for empty markdown', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}/import/markdown`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ markdown: '' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/pages/:id/copy', () => {
    it('creates a copy of the page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'Original' });

      const res = await app.request(`/api/pages/${page.id}/copy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('Copy of Original');
      expect(body.id).not.toBe(page.id);
      expect(body.ownerId).toBe(user.id);
    });

    it('keeps copied titles within the collaboration title limit', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const sourceTitle = 'x'.repeat(MAX_PAGE_TITLE_LENGTH);
      const page = await createTestPage(user.id, { title: sourceTitle });

      const res = await app.request(`/api/pages/${page.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { title: string };
      expect(body.title).toHaveLength(MAX_PAGE_TITLE_LENGTH);
      expect(body.title).toBe(`Copy of ${sourceTitle}`.slice(0, MAX_PAGE_TITLE_LENGTH));
    });

    it('copies astral titles without splitting a Unicode character', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const sourceTitle = '📚'.repeat(MAX_PAGE_TITLE_LENGTH);
      const page = await createTestPage(user.id, { title: sourceTitle });

      const res = await app.request(`/api/pages/${page.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { title: string };
      expect(Array.from(body.title)).toHaveLength(MAX_PAGE_TITLE_LENGTH);
      expect(body.title).toBe(`Copy of ${'📚'.repeat(MAX_PAGE_TITLE_LENGTH - 8)}`);
      expect(body.title).not.toContain('�');
    });

    it('allows a viewer to copy a shared page into their own workspace', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const viewer = await createTestUser();
      const session = await createTestSession(viewer.id);
      const page = await createTestPage(owner.id, { title: 'Shared Original' });
      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, viewer.id],
      );

      const res = await app.request(`/api/pages/${page.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ parentId: null }),
      });

      expect(res.status).toBe(201);
      const copied = await res.json();
      expect(copied.createdBy).toBe(viewer.id);
    });

    it('does not copy a cross-workspace page connection into the derived index', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const viewer = await createTestUser();
      const session = await createTestSession(viewer.id);
      const source = await createTestPage(owner.id, { title: 'Shared source' });
      const target = await createTestPage(owner.id, { title: 'Private target' });
      const sourceYdoc = createBoundWikiLinkYdoc(target.id);
      await query('update pages set ydoc = $1 where id = $2', [sourceYdoc, source.id]);
      await query(
        `insert into connections (
           source_type, source_id, target_type, target_id, target_slug,
           target_label, connection_type, link_text
         ) values ('page', $1, 'page', $2, $3, 'Private target', 'wikilink', 'Wiki link')`,
        [source.id, target.id, `id:${target.id}`],
      );
      await query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
        [source.id, owner.id, viewer.id],
      );

      const response = await app.request(`/api/pages/${source.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ parentId: null }),
      });

      expect(response.status).toBe(201);
      const copied = (await response.json()) as { id: string };
      expect(copied).not.toHaveProperty('ydoc');
      const copiedContent = await query<{ ydoc: Buffer }>('select ydoc from pages where id = $1', [
        copied.id,
      ]);
      expect(copiedContent.rows[0]?.ydoc.includes(Buffer.from(target.id))).toBe(true);
      const copiedConnections = await query<{ count: string }>(
        `select count(*)::text as count from connections
         where source_id = $1 and target_type = 'page'`,
        [copied.id],
      );
      expect(copiedConnections.rows[0]?.count).toBe('0');

      const presentation = await app.request(`/api/pages/${copied.id}/wiki-link-presentations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ links: [{ key: 'target', targetId: target.id }] }),
      });
      expect(await presentation.json()).toEqual({
        links: [{ key: 'target', state: 'unavailable' }],
      });
    });

    it('lets an invited editor paste a page copy into a shared folder', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const editor = await createTestUser();
      const session = await createTestSession(editor.id);
      const folder = await createTestFolder(owner.id, { name: 'Editable destination' });
      const source = await createTestPage(owner.id, {
        parentId: folder.id,
        title: 'Editor copy source',
      });
      await addFolderGrant(folder.id, editor.id, 'edit');

      const response = await app.request(`/api/pages/${source.id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ parentId: folder.id }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        parentId: folder.id,
        title: 'Copy of Editor copy source',
        createdBy: editor.id,
      });
    });

    it('denies guest page copies inside a publicly editable folder', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const folder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, {
        parentId: folder.id,
        title: 'Guest copy source',
      });
      const guestId = '44444444-4444-4444-8444-444444444444';
      await query("update folders set public_permission = 'edit' where id = $1", [folder.id]);

      const res = await app.request(`/api/pages/${page.id}/copy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `markdawn_anon_id=${guestId}`,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ parentId: folder.id }),
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        message: 'Guest editors cannot create or copy pages or folders',
      });
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages/00000000-0000-0000-0000-000000000000/copy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/pages/:id/permanent', () => {
    it('requires the owner to move the page to Trash first', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const activeRes = await app.request(`/api/pages/${page.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(activeRes.status).toBe(409);

      const softDeleteRes = await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(softDeleteRes.status).toBe(200);

      const res = await app.request(`/api/pages/${page.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie, Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(true);
    });

    it('does not let a non-owner Admin purge a trashed page', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const admin = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const adminSession = await createTestSession(admin.id);
      const page = await createTestPage(owner.id);
      await query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'admin')`,
        [page.id, owner.id, admin.id],
      );

      const activePurgeRes = await app.request(`/api/pages/${page.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: adminSession.Cookie },
      });
      expect(activePurgeRes.status).toBe(403);

      const softDeleteRes = await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: adminSession.Cookie },
      });
      expect(softDeleteRes.status).toBe(200);

      const purgeRes = await app.request(`/api/pages/${page.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: adminSession.Cookie },
      });
      expect(purgeRes.status).toBe(403);

      const ownerPurgeRes = await app.request(`/api/pages/${page.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: ownerSession.Cookie },
      });
      expect(ownerPurgeRes.status).toBe(200);
    });

    it('removes polymorphic grant, public-visit, and favorite metadata', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const session = await createTestSession(owner.id);
      const page = await createTestPage(owner.id);
      await query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, recipient.id],
      );
      await query(
        `insert into page_public_access_visits (page_id, user_id)
         values ($1, $2)`,
        [page.id, recipient.id],
      );
      await query(
        `insert into user_favorites (user_id, entity_type, entity_id)
         values ($1, 'page', $2)`,
        [recipient.id, page.id],
      );

      await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      const purgeRes = await app.request(`/api/pages/${page.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(purgeRes.status).toBe(200);

      const leftovers = await query<{ grants: string; visits: string; favorites: string }>(
        `select
           (select count(*) from shares where entity_type = 'page' and entity_id = $1)::text as grants,
           (select count(*) from page_public_access_visits where page_id = $1)::text as visits,
           (select count(*) from user_favorites where entity_type = 'page' and entity_id = $1)::text as favorites`,
        [page.id],
      );
      expect(leftovers.rows[0]).toEqual({ grants: '0', visits: '0', favorites: '0' });
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages/00000000-0000-0000-0000-000000000000/permanent', {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/pages/:id', () => {
    it('returns a specific page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, {
        title: 'My Page',
      });

      const res = await app.request(`/api/pages/${page.id}`, {
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('My Page');
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages/00000000-0000-0000-0000-000000000000', {
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/pages/:id', () => {
    it('updates a page title', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, {
        title: 'Original',
      });
      const revisionBefore = await readWorkspaceAccessVersion(user.id);

      const res = await app.request(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ title: 'Updated Title' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('Updated Title');
      expect(await readWorkspaceAccessVersion(user.id)).toBe(revisionBefore);
    });

    it('rejects signed-in title updates longer than 250 characters', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id, { title: 'Original' });

      const res = await app.request(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: 'T'.repeat(251) }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: 'Title must be 250 characters or fewer' });
    });

    it('rejects a non-numeric page position', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ position: 'not-a-number' }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_POSITION' });
    });

    it('allows editors to update page content metadata', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const editor = await createTestUser();
      const session = await createTestSession(editor.id);
      const page = await createTestPage(owner.id, { title: 'Original' });
      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'edit')`,
        [page.id, owner.id, editor.id],
      );

      const res = await app.request(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
        body: JSON.stringify({ title: 'Edited', icon: 'x', properties: { tags: ['shared'] } }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe('Edited');
      expect(body.icon).toBe('x');
    });

    it('returns 400 when setting parentId to self', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ parentId: page.id }),
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent parentId', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ parentId: '00000000-0000-0000-0000-000000000000' }),
      });
      expect(res.status).toBe(404);
    });

    it('updates properties as JSON', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ properties: { status: 'done', priority: 1 } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.properties).toEqual({ status: 'done', priority: 1 });
    });

    it('rejects a scalar tags property', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ properties: { tags: '' } }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        message: 'properties.tags must be an array of strings',
      });
    });

    it('replaces tag connections when properties change', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);
      await query(
        `insert into connections (
           source_type, source_id, target_type, target_slug, target_label,
           connection_type, occurrence_count
         ) values ('page', $1, 'page', 'existing-link', 'Existing link', 'wiki-link', 1)`,
        [page.id],
      );

      for (const tags of [['first'], ['second'], []] as const) {
        const response = await app.request(`/api/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
          body: JSON.stringify({ properties: { tags } }),
        });
        expect(response.status).toBe(200);

        const indexed = await query<{ target_slug: string }>(
          `select target_slug from connections
           where source_type = 'page' and source_id = $1 and connection_type = 'tag'
           order by target_slug`,
          [page.id],
        );
        expect(indexed.rows.map((row) => row.target_slug)).toEqual(tags.map((tag) => `#${tag}`));
      }
      const contentConnections = await query<{ count: string }>(
        `select count(*)::text as count from connections
         where source_type = 'page' and source_id = $1 and connection_type = 'wiki-link'`,
        [page.id],
      );
      expect(contentConnections.rows[0]?.count).toBe('1');
    });

    it('keeps inline tags indexed when properties change', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);
      await query('update pages set ydoc = $1 where id = $2', [
        Buffer.from(markdownToYjsState('#inline')),
        page.id,
      ]);

      for (const tags of [['property'], ['replacement']] as const) {
        const response = await app.request(`/api/pages/${page.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: session.Cookie },
          body: JSON.stringify({ properties: { tags } }),
        });
        expect(response.status).toBe(200);

        const indexed = await query<{ target_slug: string }>(
          `select target_slug from connections
           where source_type = 'page' and source_id = $1 and connection_type = 'tag'
           order by target_slug`,
          [page.id],
        );
        expect(indexed.rows.map((row) => row.target_slug)).toEqual(['#inline', `#${tags[0]}`]);
      }
    });
  });

  describe('DELETE /api/pages/:id', () => {
    it('soft-deletes a page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(true);
    });
  });

  describe('POST /api/pages/:id/leave', () => {
    it('returns 401 without session', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}/leave`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 when user owns the page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request(`/api/pages/${page.id}/leave`, {
        method: 'POST',
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain('Cannot leave your own page');
    });

    it('returns 404 for non-existent page', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/pages/00000000-0000-0000-0000-000000000000/leave', {
        method: 'POST',
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });
      expect(res.status).toBe(404);
    });

    it('removes an account grant for a page', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const session = await createTestSession(recipient.id);
      const page = await createTestPage(owner.id);

      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, recipient.id],
      );

      const res = await app.request(`/api/pages/${page.id}/leave`, {
        method: 'POST',
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const shareCheck = await query(
        `SELECT id FROM shares WHERE entity_id = $1 AND recipient_user_id = $2`,
        [page.id, recipient.id],
      );
      expect(shareCheck.rowCount).toBe(0);
    });

    it('removes public-visit provenance and notifies visitor access and owner metadata', async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) throw new Error('DATABASE_URL is required');

      const app = await createTestApp();
      const owner = await createTestUser();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(owner.id);

      await query(
        `insert into page_public_access_visits (page_id, user_id, first_seen_at, last_seen_at)
         values ($1, $2, now(), now())`,
        [page.id, user.id],
      );

      const listener = new Client({ connectionString });
      const payloads: string[] = [];
      listener.on('notification', (notification) => {
        if (notification.channel === 'share_event' && notification.payload) {
          payloads.push(notification.payload);
        }
      });
      await listener.connect();
      await listener.query('listen share_event');

      try {
        const res = await app.request(`/api/pages/${page.id}/leave`, {
          method: 'POST',
          headers: {
            Cookie: session.Cookie,
            Origin: 'http://localhost:5173',
          },
        });
        expect(res.status).toBe(200);
        expect((await res.json()).ok).toBe(true);

        const visitCheck = await query(
          `select id from page_public_access_visits where page_id = $1 and user_id = $2`,
          [page.id, user.id],
        );
        expect(visitCheck.rowCount).toBe(0);

        const notifications = await flushShareEventNotifications(payloads);
        expect(notifications).toContainEqual(
          expect.objectContaining({
            action: 'revoke',
            entityType: 'page',
            entityId: page.id,
            targetUserId: user.id,
            metaUserIds: [owner.id],
          }),
        );
      } finally {
        await listener.end();
      }
    });

    it('rejects leave requests with no direct grant or public-visit record', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const session = await createTestSession(stranger.id);
      const page = await createTestPage(owner.id);

      const res = await app.request(`/api/pages/${page.id}/leave`, {
        method: 'POST',
        headers: {
          Cookie: session.Cookie,
          Origin: 'http://localhost:5173',
        },
      });
      expect(res.status).toBe(409);
    });
  });
});
