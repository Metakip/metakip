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
  enableTestPagePublicAccess,
} from '../test-utils';
import { MAX_IMAGE_SIZE_BYTES } from '../utils/image-upload';
import { lockWorkspaceAccessMutation } from '../utils/share-access';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function waitForBlockedPid(blockerPid: number): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await query<{ pid: number }>(
      `select pid
       from pg_stat_activity
       where $1 = any(pg_blocking_pids(pid))
       order by pid
       limit 1`,
      [blockerPid],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for a request blocked by PID ${blockerPid}`);
}

async function runUploadReadBarrier(
  ownerId: string,
  request: () => Response | Promise<Response>,
  mutateAccess: () => Promise<void>,
): Promise<Response> {
  let releaseWorkspaceLock = (): void => undefined;
  let reportBlockerPid = (_pid: number): void => undefined;
  const lockReleased = new Promise<void>((resolve) => {
    releaseWorkspaceLock = resolve;
  });
  const blockerReady = new Promise<number>((resolve) => {
    reportBlockerPid = resolve;
  });
  const blocker = db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, ownerId);
    const pidResult = await executeQuery<{ pid: number }>(
      tx,
      sql.raw('select pg_backend_pid() as pid'),
    );
    const pid = pidResult.rows[0]?.pid;
    if (!pid) throw new Error('Failed to resolve upload read blocker PID');
    reportBlockerPid(pid);
    await lockReleased;
  });

  const blockerPid = await blockerReady;
  const responsePromise = Promise.resolve(request());
  await waitForBlockedPid(blockerPid);
  const mutationPromise = mutateAccess();
  await waitForBlockedPid(blockerPid);
  releaseWorkspaceLock();
  await blocker;

  const response = await responsePromise;
  await mutationPromise;
  return response;
}

describe('uploads API', () => {
  describe('auth guard', () => {
    it('returns 401 without session cookie', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/uploads', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('returns 401 with invalid session token', async () => {
      const app = await createTestApp();
      const res = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/uploads', () => {
    it('uploads an image file', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const formData = new FormData();
      formData.append('file', new File([PNG_BYTES], 'test.png', { type: 'image/png' }));
      formData.append('pageId', page.id);

      const res = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.url).toMatch(/^\/api\/uploads\//);
    });

    it('rejects oversized multipart bodies before parsing the upload', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);
      const formData = new FormData();
      formData.append(
        'file',
        new File([new Uint8Array(MAX_IMAGE_SIZE_BYTES + 512 * 1024)], 'oversized.png', {
          type: 'image/png',
        }),
      );
      formData.append('pageId', page.id);

      const response = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ message: 'Request body is too large' });
    });

    it('rejects active content disguised as an image', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);
      const formData = new FormData();
      formData.append(
        'file',
        new File(['<script>alert(1)</script>'], 'attack.png', { type: 'image/png' }),
      );
      formData.append('pageId', page.id);

      const res = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for unsupported file type', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const formData = new FormData();
      formData.append('file', new File(['text'], 'test.txt', { type: 'text/plain' }));
      formData.append('pageId', page.id);

      const res = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when file is missing', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const res = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: (() => {
          const formData = new FormData();
          formData.append('pageId', page.id);
          return formData;
        })(),
      });

      expect(res.status).toBe(400);
    });

    it('denies guest uploads on publicly editable pages', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const page = await createTestPage(owner.id);
      await query("update pages set public_permission = 'edit' where id = $1", [page.id]);
      const guestId = crypto.randomUUID();
      const formData = new FormData();
      formData.append('file', new File([PNG_BYTES], 'guest.png', { type: 'image/png' }));
      formData.append('pageId', page.id);

      const response = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: `metakip_anon_id=${guestId}` },
        body: formData,
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        message: 'Guest editors cannot upload files',
      });
    });

    it('denies guest uploads on public view-only pages', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const page = await createTestPage(owner.id);
      await query("update pages set public_permission = 'view' where id = $1", [page.id]);
      const formData = new FormData();
      formData.append('file', new File([PNG_BYTES], 'denied.png', { type: 'image/png' }));
      formData.append('pageId', page.id);

      const response = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: `metakip_anon_id=${crypto.randomUUID()}` },
        body: formData,
      });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/uploads/:filename', () => {
    it('returns 400 for invalid filename characters', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/uploads/file@name.png', {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent file', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);

      const res = await app.request('/api/uploads/nonexistent.png', {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(404);
    });

    it('returns uploaded file bytes with correct Content-Type', async () => {
      const app = await createTestApp();
      const user = await createTestUser();
      const session = await createTestSession(user.id);
      const page = await createTestPage(user.id);

      const binaryData = PNG_BYTES;
      const formData = new FormData();
      formData.append('file', new File([binaryData], 'real.png', { type: 'image/png' }));
      formData.append('pageId', page.id);

      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: session.Cookie },
        body: formData,
      });
      expect(uploadRes.status).toBe(200);
      const { url } = await uploadRes.json();

      const res = await app.request(url, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      const returned = new Uint8Array(await res.arrayBuffer());
      expect(returned).toEqual(binaryData);
    });

    it('allows recipients to fetch uploads from directly shared root pages', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const recipientSession = await createTestSession(recipient.id);
      const page = await createTestPage(owner.id, { title: 'Shared Root Page' });

      const binaryData = PNG_BYTES;
      const formData = new FormData();
      formData.append('file', new File([binaryData], 'shared-root.png', { type: 'image/png' }));
      formData.append('pageId', page.id);

      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: ownerSession.Cookie },
        body: formData,
      });
      expect(uploadRes.status).toBe(200);
      const { url } = (await uploadRes.json()) as { url: string };

      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, recipient.id],
      );

      const res = await app.request(url, {
        headers: { Cookie: recipientSession.Cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
    });

    it('serializes authenticated byte reads before a concurrent revoke', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const recipientSession = await createTestSession(recipient.id);
      const page = await createTestPage(owner.id, { title: 'Atomic attachment read' });

      const formData = new FormData();
      formData.append('file', new File([PNG_BYTES], 'atomic-private.png', { type: 'image/png' }));
      formData.append('pageId', page.id);
      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: ownerSession.Cookie },
        body: formData,
      });
      expect(uploadRes.status).toBe(200);
      const { url } = (await uploadRes.json()) as { url: string };
      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, recipient.id],
      );

      const response = await runUploadReadBarrier(
        owner.id,
        () => app.request(url, { headers: { Cookie: recipientSession.Cookie } }),
        () =>
          db.transaction(async (tx) => {
            await lockWorkspaceAccessMutation(tx, owner.id);
            await executeQuery(
              tx,
              sql`DELETE FROM shares
               WHERE entity_type = 'page' AND entity_id = ${page.id} AND recipient_user_id = ${recipient.id}`,
            );
          }),
      );

      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
      const afterRevoke = await app.request(url, {
        headers: { Cookie: recipientSession.Cookie },
      });
      expect(afterRevoke.status).toBe(403);
    });

    it('revokes an uploader from a referenced upload while preserving current page access', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const uploader = await createTestUser();
      const currentRecipient = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const uploaderSession = await createTestSession(uploader.id);
      const currentRecipientSession = await createTestSession(currentRecipient.id);
      const page = await createTestPage(owner.id, { title: 'Attachment revocation' });

      const uploaderShare = await query<{ id: string }>(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'edit')
         RETURNING id`,
        [page.id, owner.id, uploader.id],
      );
      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, currentRecipient.id],
      );

      const formData = new FormData();
      formData.append('file', new File([PNG_BYTES], 'revoked-uploader.png', { type: 'image/png' }));
      formData.append('pageId', page.id);
      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: uploaderSession.Cookie },
        body: formData,
      });
      expect(uploadRes.status).toBe(200);
      const { url } = (await uploadRes.json()) as { url: string };

      const beforeRevoke = await app.request(url, {
        headers: { Cookie: uploaderSession.Cookie },
      });
      expect(beforeRevoke.status).toBe(200);
      expect(beforeRevoke.headers.get('Cache-Control')).toBe('private, no-store');

      const shareId = uploaderShare.rows[0]?.id;
      if (!shareId) {
        throw new Error('Expected uploader share ID');
      }
      const revokeRes = await app.request(`/api/shares/grants/${shareId}`, {
        method: 'DELETE',
        headers: { Cookie: ownerSession.Cookie },
      });
      expect(revokeRes.status).toBe(200);

      const [revokedUploaderRes, ownerRes, currentRecipientRes] = await Promise.all([
        app.request(url, { headers: { Cookie: uploaderSession.Cookie } }),
        app.request(url, { headers: { Cookie: ownerSession.Cookie } }),
        app.request(url, { headers: { Cookie: currentRecipientSession.Cookie } }),
      ]);
      expect(revokedUploaderRes.status).toBe(403);
      expect(revokedUploaderRes.headers.get('Cache-Control')).toBe('no-store');
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.headers.get('Cache-Control')).toBe('private, no-store');
      expect(currentRecipientRes.status).toBe(200);
      expect(currentRecipientRes.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('keeps the uploader fallback only after an upload has no page references', async () => {
      const app = await createTestApp();
      const uploader = await createTestUser();
      const otherUser = await createTestUser();
      const uploaderSession = await createTestSession(uploader.id);
      const otherSession = await createTestSession(otherUser.id);
      const page = await createTestPage(uploader.id, { title: 'Temporary upload page' });

      const formData = new FormData();
      formData.append('file', new File([PNG_BYTES], 'orphan.png', { type: 'image/png' }));
      formData.append('pageId', page.id);
      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: uploaderSession.Cookie },
        body: formData,
      });
      expect(uploadRes.status).toBe(200);
      const { url } = (await uploadRes.json()) as { url: string };
      await query(
        `DELETE FROM upload_page_refs
         WHERE upload_id = (SELECT id FROM uploads WHERE filename = $1)`,
        [url.split('/').at(-1)],
      );

      const [uploaderRes, otherRes] = await Promise.all([
        app.request(url, { headers: { Cookie: uploaderSession.Cookie } }),
        app.request(url, { headers: { Cookie: otherSession.Cookie } }),
      ]);
      expect(uploaderRes.status).toBe(200);
      expect(otherRes.status).toBe(403);
    });

    it('blocks users who only have access to a different page by the upload owner', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const recipientSession = await createTestSession(recipient.id);
      const uploadPage = await createTestPage(owner.id, { title: 'Upload Page' });
      const sharedPage = await createTestPage(owner.id, { title: 'Other Shared Page' });

      const formData = new FormData();
      formData.append('file', new File([PNG_BYTES], 'scoped.png', { type: 'image/png' }));
      formData.append('pageId', uploadPage.id);

      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: ownerSession.Cookie },
        body: formData,
      });
      const { url } = (await uploadRes.json()) as { url: string };

      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'view')`,
        [sharedPage.id, owner.id, recipient.id],
      );

      const res = await app.request(url, {
        headers: { Cookie: recipientSession.Cookie },
      });

      expect(res.status).toBe(403);
    });

    it('blocks anonymous downloads for private page uploads', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const page = await createTestPage(owner.id, { title: 'Private Page' });

      const formData = new FormData();
      formData.append('file', new File([PNG_BYTES], 'private.png', { type: 'image/png' }));
      formData.append('pageId', page.id);

      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: ownerSession.Cookie },
        body: formData,
      });
      const { url } = (await uploadRes.json()) as { url: string };

      const res = await app.request(url);

      expect(res.status).toBe(404);
    });

    it('allows anonymous downloads for public page uploads', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const page = await createTestPage(owner.id, { title: 'Public Page' });

      const binaryData = PNG_BYTES;
      const formData = new FormData();
      formData.append('file', new File([binaryData], 'public.png', { type: 'image/png' }));
      formData.append('pageId', page.id);

      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: ownerSession.Cookie },
        body: formData,
      });
      const { url } = (await uploadRes.json()) as { url: string };
      await enableTestPagePublicAccess(page.id);

      const res = await app.request(url);

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(binaryData);
    });

    it('serializes anonymous byte reads before concurrent public-access revocation', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const page = await createTestPage(owner.id, { title: 'Atomic public attachment read' });

      const formData = new FormData();
      formData.append('file', new File([PNG_BYTES], 'atomic-public.png', { type: 'image/png' }));
      formData.append('pageId', page.id);
      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: ownerSession.Cookie },
        body: formData,
      });
      expect(uploadRes.status).toBe(200);
      const { url } = (await uploadRes.json()) as { url: string };
      await enableTestPagePublicAccess(page.id);

      const response = await runUploadReadBarrier(
        owner.id,
        () => app.request(url),
        () =>
          db.transaction(async (tx) => {
            await lockWorkspaceAccessMutation(tx, owner.id);
            await executeQuery(
              tx,
              sql`UPDATE pages
               SET public_permission = null, updated_at = now()
               WHERE id = ${page.id}`,
            );
          }),
      );

      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
      const afterDisable = await app.request(url);
      expect(afterDisable.status).toBe(404);
    });

    it('allows anonymous downloads for uploads in public folders', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const folder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, { parentId: folder.id });

      const binaryData = PNG_BYTES;
      const formData = new FormData();
      formData.append('file', new File([binaryData], 'folder-public.png', { type: 'image/png' }));
      formData.append('pageId', page.id);

      const uploadRes = await app.request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: ownerSession.Cookie },
        body: formData,
      });
      const { url } = (await uploadRes.json()) as { url: string };
      await query("UPDATE folders SET public_permission = 'view' WHERE id = $1", [folder.id]);

      const res = await app.request(url);

      expect(res.status).toBe(200);
    });
  });
});
