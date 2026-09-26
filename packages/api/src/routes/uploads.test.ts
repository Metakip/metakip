import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
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
import { createApiTokenSecret } from '../utils/apiTokens';
import { lockWorkspaceAccessMutation } from '../utils/share-access';
import { getUploadStorage } from '../utils/uploadStorage';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function runUploadReadBarrier(
  url: string,
  request: () => Response | Promise<Response>,
  mutateAccess: () => Promise<void>,
): Promise<Response> {
  const filename = url.split('/').at(-1);
  if (!filename) throw new Error('Upload URL did not include a filename');

  const storage = getUploadStorage();
  const readBytes = storage.get.bind(storage);
  let reportReadStarted = (): void => undefined;
  let releaseRead = (): void => undefined;
  const readStarted = new Promise<void>((resolve) => {
    reportReadStarted = resolve;
  });
  const readReleased = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const getSpy = vi.spyOn(storage, 'get').mockImplementation(async (key) => {
    if (key === filename) {
      reportReadStarted();
      await readReleased;
    }
    return readBytes(key);
  });

  try {
    const responsePromise = Promise.resolve().then(request);
    await Promise.race([
      readStarted,
      responsePromise.then(() => {
        throw new Error('Upload request finished before reaching storage');
      }),
    ]);
    // The first authorization has committed. Revoke access while the object
    // read is paused, then allow the request to perform its final access check.
    await mutateAccess();
    releaseRead();
    return await responsePromise;
  } finally {
    releaseRead();
    getSpy.mockRestore();
  }
}

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function uploadImage(
  app: TestApp,
  cookie: string,
  pageId: string,
  originalName: string,
): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('file', new File([PNG_BYTES], originalName, { type: 'image/png' }));
  const response = await app.request(`/api/v1/pages/${pageId}/images`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: formData,
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { url: string };
}

describe('uploads API', () => {
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

      const { url } = await uploadImage(app, session.Cookie, page.id, 'real.png');

      const res = await app.request(url, {
        headers: { Cookie: session.Cookie },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      const returned = new Uint8Array(await res.arrayBuffer());
      expect(returned).toEqual(PNG_BYTES);
    });

    it('serves private images to readable API tokens but not write-only tokens', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const session = await createTestSession(owner.id);
      const page = await createTestPage(owner.id);
      const { url } = await uploadImage(app, session.Cookie, page.id, 'token-image.png');
      const readable = createApiTokenSecret();
      const writeOnly = createApiTokenSecret();
      const unrelatedUser = await createTestUser();
      const unrelated = createApiTokenSecret();
      for (const [secret, scopes] of [
        [readable, ['pages:read']],
        [writeOnly, ['pages:write']],
      ] as const) {
        await query(
          `insert into api_tokens (id, user_id, name, token_hash, scopes)
           values ($1, $2, $3, $4, $5)`,
          [secret.id, owner.id, 'Image download test', secret.tokenHash, [...scopes]],
        );
      }
      await query(
        `insert into api_tokens (id, user_id, name, token_hash, scopes)
         values ($1, $2, $3, $4, $5)`,
        [
          unrelated.id,
          unrelatedUser.id,
          'Unrelated image reader',
          unrelated.tokenHash,
          ['pages:read'],
        ],
      );

      const downloaded = await app.request(url, {
        headers: { Authorization: `Bearer ${readable.token}` },
      });
      expect(downloaded.status).toBe(200);
      expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(PNG_BYTES);
      expect(
        (
          await app.request(url, {
            headers: { Authorization: `Bearer ${writeOnly.token}` },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.request(url, {
            headers: { Authorization: 'Bearer invalid-token' },
          })
        ).status,
      ).toBe(401);
      expect(
        (await app.request(url, { headers: { Authorization: `Bearer ${unrelated.token}` } }))
          .status,
      ).toBe(403);
      await query('update api_tokens set revoked_at = now() where id = $1', [readable.id]);
      expect(
        (await app.request(url, { headers: { Authorization: `Bearer ${readable.token}` } })).status,
      ).toBe(401);
    });

    it('allows recipients to fetch uploads from directly shared root pages', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const recipientSession = await createTestSession(recipient.id);
      const page = await createTestPage(owner.id, { title: 'Shared Root Page' });

      const { url } = await uploadImage(app, ownerSession.Cookie, page.id, 'shared-root.png');

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

    it('rejects an authenticated byte read when access is revoked during storage I/O', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const recipient = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const recipientSession = await createTestSession(recipient.id);
      const page = await createTestPage(owner.id, { title: 'Atomic attachment read' });

      const { url } = await uploadImage(app, ownerSession.Cookie, page.id, 'atomic-private.png');
      await query(
        `INSERT INTO shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         VALUES ('page', $1, $2, $3, 'view')`,
        [page.id, owner.id, recipient.id],
      );

      const response = await runUploadReadBarrier(
        url,
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

      expect(response.status).toBe(403);
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

      const { url } = await uploadImage(
        app,
        uploaderSession.Cookie,
        page.id,
        'revoked-uploader.png',
      );

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

      const { url } = await uploadImage(app, uploaderSession.Cookie, page.id, 'orphan.png');
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

      const { url } = await uploadImage(app, ownerSession.Cookie, uploadPage.id, 'scoped.png');

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

      const { url } = await uploadImage(app, ownerSession.Cookie, page.id, 'private.png');

      const res = await app.request(url);

      expect(res.status).toBe(404);
    });

    it('allows anonymous downloads for public page uploads', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const page = await createTestPage(owner.id, { title: 'Public Page' });

      const { url } = await uploadImage(app, ownerSession.Cookie, page.id, 'public.png');
      await enableTestPagePublicAccess(page.id);

      const res = await app.request(url);

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
    });

    it('rejects an anonymous byte read when public access is revoked during storage I/O', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const page = await createTestPage(owner.id, { title: 'Atomic public attachment read' });

      const { url } = await uploadImage(app, ownerSession.Cookie, page.id, 'atomic-public.png');
      await enableTestPagePublicAccess(page.id);

      const response = await runUploadReadBarrier(
        url,
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

      expect(response.status).toBe(404);
      const afterDisable = await app.request(url);
      expect(afterDisable.status).toBe(404);
    });

    it('allows anonymous downloads for uploads in public folders', async () => {
      const app = await createTestApp();
      const owner = await createTestUser();
      const ownerSession = await createTestSession(owner.id);
      const folder = await createTestFolder(owner.id);
      const page = await createTestPage(owner.id, { parentId: folder.id });

      const { url } = await uploadImage(app, ownerSession.Cookie, page.id, 'folder-public.png');
      await query("UPDATE folders SET public_permission = 'view' WHERE id = $1", [folder.id]);

      const res = await app.request(url);

      expect(res.status).toBe(200);
    });
  });
});
