import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../db/connection';
import { executeQuery } from '../db/query';
import { testQuery as query } from '../db/testQuery';
import { uploadsDir } from '../env';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../test-utils';
import {
  processUploadDeletionQueue,
  purgeUnreferencedUploadsForPages,
} from '../utils/uploadCleanup';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

async function uploadImage(
  app: TestApp,
  cookie: string,
  pageId: string,
  originalName: string,
): Promise<{ url: string; filename: string; filePath: string }> {
  const formData = new FormData();
  formData.append('file', new File([PNG_BYTES], originalName, { type: 'image/png' }));
  const response = await app.request(`/api/v1/pages/${pageId}/images`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: formData,
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { url: string };
  const filename = body.url.split('/').at(-1);
  if (!filename) throw new Error('Upload response did not include a filename');
  return { url: body.url, filename, filePath: path.join(uploadsDir, filename) };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeTestFiles(filePaths: readonly string[]): Promise<void> {
  await Promise.all(filePaths.map((filePath) => rm(filePath, { force: true })));
}

async function waitForUploadLockWaiter(blockerPid: number): Promise<number> {
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
  throw new Error('Timed out waiting for concurrent purges to lock the shared upload');
}

async function trashPage(app: TestApp, cookie: string, pageId: string): Promise<void> {
  const response = await app.request(`/api/pages/${pageId}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
}

async function trashFolder(app: TestApp, cookie: string, folderId: string): Promise<void> {
  const response = await app.request(`/api/folders/${folderId}?force=true`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
}

async function expectUploadPurged(
  app: TestApp,
  cookie: string,
  upload: { url: string; filename: string; filePath: string },
): Promise<void> {
  await processUploadDeletionQueue();
  const databaseState = await query<{ uploads: string; refs: string }>(
    `select
       (select count(*) from uploads where filename = $1)::text as uploads,
       (select count(*)
        from upload_page_refs upr
        join uploads u on u.id = upr.upload_id
        where u.filename = $1)::text as refs`,
    [upload.filename],
  );
  expect(databaseState.rows[0]).toEqual({ uploads: '0', refs: '0' });
  expect(await fileExists(upload.filePath)).toBe(false);
  const download = await app.request(upload.url, { headers: { Cookie: cookie } });
  expect(download.status).toBe(404);
}

describe('permanent purge upload cleanup', () => {
  it('deletes the last-reference upload row and file when a page is permanently deleted', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);
    const page = await createTestPage(owner.id);
    const upload = await uploadImage(app, session.Cookie, page.id, 'page-purge.png');

    try {
      await trashPage(app, session.Cookie, page.id);
      const purge = await app.request(`/api/pages/${page.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(purge.status).toBe(200);
      await expectUploadPurged(app, session.Cookie, upload);
    } finally {
      await removeTestFiles([upload.filePath]);
    }
  });

  it('preserves an upload referenced by a surviving page until its final reference is purged', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);
    const firstPage = await createTestPage(owner.id, { title: 'First upload reference' });
    const survivingPage = await createTestPage(owner.id, { title: 'Surviving upload reference' });
    const upload = await uploadImage(app, session.Cookie, firstPage.id, 'shared-reference.png');
    await query(
      `insert into upload_page_refs (upload_id, page_id)
       select id, $2 from uploads where filename = $1`,
      [upload.filename, survivingPage.id],
    );

    try {
      await trashPage(app, session.Cookie, firstPage.id);
      const firstPurge = await app.request(`/api/pages/${firstPage.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(firstPurge.status).toBe(200);

      const retained = await query<{ uploads: string; surviving_refs: string }>(
        `select
           (select count(*) from uploads where filename = $1)::text as uploads,
           (select count(*)
            from upload_page_refs upr
            join uploads u on u.id = upr.upload_id
            where u.filename = $1 and upr.page_id = $2)::text as surviving_refs`,
        [upload.filename, survivingPage.id],
      );
      expect(retained.rows[0]).toEqual({ uploads: '1', surviving_refs: '1' });
      expect(await fileExists(upload.filePath)).toBe(true);
      const download = await app.request(upload.url, { headers: { Cookie: session.Cookie } });
      expect(download.status).toBe(200);

      await trashPage(app, session.Cookie, survivingPage.id);
      const finalPurge = await app.request(`/api/pages/${survivingPage.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(finalPurge.status).toBe(200);
      await expectUploadPurged(app, session.Cookie, upload);
    } finally {
      await removeTestFiles([upload.filePath]);
    }
  });

  it('serializes cross-workspace purges of the final shared upload references', async () => {
    const app = await createTestApp();
    const firstOwner = await createTestUser();
    const secondOwner = await createTestUser();
    const firstSession = await createTestSession(firstOwner.id);
    const secondSession = await createTestSession(secondOwner.id);
    const firstPage = await createTestPage(firstOwner.id, { title: 'First workspace page' });
    const secondPage = await createTestPage(secondOwner.id, { title: 'Second workspace page' });
    const upload = await uploadImage(
      app,
      firstSession.Cookie,
      firstPage.id,
      'cross-workspace-shared.png',
    );
    await query(
      `insert into upload_page_refs (upload_id, page_id)
       select id, $2 from uploads where filename = $1`,
      [upload.filename, secondPage.id],
    );
    await trashPage(app, firstSession.Cookie, firstPage.id);
    await trashPage(app, secondSession.Cookie, secondPage.id);

    let releaseUploadLock = (): void => undefined;
    let reportBlockerPid = (_pid: number): void => undefined;
    const uploadLockReleased = new Promise<void>((resolve) => {
      releaseUploadLock = resolve;
    });
    const blockerReady = new Promise<number>((resolve) => {
      reportBlockerPid = resolve;
    });
    const uploadBlocker = db.transaction(async (tx) => {
      const result = await executeQuery<{ pid: number }>(
        tx,
        sql`select pg_backend_pid() as pid
         from uploads
         where filename = ${upload.filename}
         for update`,
      );
      const pid = result.rows[0]?.pid;
      if (!pid) throw new Error('Failed to resolve shared upload blocker PID');
      reportBlockerPid(pid);
      await uploadLockReleased;
    });

    try {
      const blockerPid = await blockerReady;
      const firstPurge = app.request(`/api/pages/${firstPage.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: firstSession.Cookie },
      });
      const secondPurge = app.request(`/api/pages/${secondPage.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: secondSession.Cookie },
      });

      let orchestrationError: unknown = null;
      try {
        const firstPurgePid = await waitForUploadLockWaiter(blockerPid);
        await waitForUploadLockWaiter(firstPurgePid);
      } catch (error) {
        orchestrationError = error;
      } finally {
        releaseUploadLock();
        await uploadBlocker;
      }

      const responses = await Promise.all([firstPurge, secondPurge]);
      if (orchestrationError) throw orchestrationError;
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      await expectUploadPurged(app, firstSession.Cookie, upload);
    } finally {
      releaseUploadLock();
      await uploadBlocker.catch(() => undefined);
      await removeTestFiles([upload.filePath]);
    }
  });

  it('deletes last-reference uploads for a permanently deleted folder subtree', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);
    const folder = await createTestFolder(owner.id, { name: 'Upload folder' });
    const page = await createTestPage(owner.id, { parentId: folder.id });
    const upload = await uploadImage(app, session.Cookie, page.id, 'folder-purge.png');

    try {
      await trashFolder(app, session.Cookie, folder.id);
      const purge = await app.request(`/api/folders/${folder.id}/permanent`, {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(purge.status).toBe(200);
      await expectUploadPurged(app, session.Cookie, upload);
    } finally {
      await removeTestFiles([upload.filePath]);
    }
  });

  it('cleans uploads through the page and folder empty-trash compatibility routes', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);
    const page = await createTestPage(owner.id, { title: 'Page compatibility trash' });
    const pageUpload = await uploadImage(app, session.Cookie, page.id, 'page-empty-trash.png');
    const folder = await createTestFolder(owner.id, { name: 'Folder compatibility trash' });
    const folderPage = await createTestPage(owner.id, { parentId: folder.id });
    const folderUpload = await uploadImage(
      app,
      session.Cookie,
      folderPage.id,
      'folder-empty-trash.png',
    );

    try {
      await trashPage(app, session.Cookie, page.id);
      const emptyPages = await app.request('/api/pages/trash/empty-all', {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(emptyPages.status).toBe(200);
      await expectUploadPurged(app, session.Cookie, pageUpload);

      await trashFolder(app, session.Cookie, folder.id);
      const emptyFolders = await app.request('/api/folders/trash/empty-all', {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(emptyFolders.status).toBe(200);
      await expectUploadPurged(app, session.Cookie, folderUpload);
    } finally {
      await removeTestFiles([pageUpload.filePath, folderUpload.filePath]);
    }
  });

  it('cleans only last-reference uploads when emptying unified Trash', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);
    const folder = await createTestFolder(owner.id, { name: 'Unified trash folder' });
    const folderPage = await createTestPage(owner.id, { parentId: folder.id });
    const folderUpload = await uploadImage(
      app,
      session.Cookie,
      folderPage.id,
      'unified-folder.png',
    );
    const standalonePage = await createTestPage(owner.id, { title: 'Unified standalone page' });
    const survivingPage = await createTestPage(owner.id, { title: 'Unified surviving page' });
    const sharedUpload = await uploadImage(
      app,
      session.Cookie,
      standalonePage.id,
      'unified-shared.png',
    );
    await query(
      `insert into upload_page_refs (upload_id, page_id)
       select id, $2 from uploads where filename = $1`,
      [sharedUpload.filename, survivingPage.id],
    );

    try {
      await trashFolder(app, session.Cookie, folder.id);
      await trashPage(app, session.Cookie, standalonePage.id);
      const emptyTrash = await app.request('/api/trash/empty-all', {
        method: 'DELETE',
        headers: { Cookie: session.Cookie },
      });
      expect(emptyTrash.status).toBe(200);
      expect(await emptyTrash.json()).toEqual({ deleted: true, folders: 1, pages: 2 });
      await expectUploadPurged(app, session.Cookie, folderUpload);

      expect(await fileExists(sharedUpload.filePath)).toBe(true);
      const sharedDownload = await app.request(sharedUpload.url, {
        headers: { Cookie: session.Cookie },
      });
      expect(sharedDownload.status).toBe(200);
      const sharedState = await query<{ uploads: string; refs: string }>(
        `select
           (select count(*) from uploads where filename = $1)::text as uploads,
           (select count(*)
            from upload_page_refs upr
            join uploads u on u.id = upr.upload_id
            where u.filename = $1)::text as refs`,
        [sharedUpload.filename],
      );
      expect(sharedState.rows[0]).toEqual({ uploads: '1', refs: '1' });
    } finally {
      await removeTestFiles([folderUpload.filePath, sharedUpload.filePath]);
    }
  });

  it('keeps upload rows and bytes when the database purge transaction rolls back', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);
    const page = await createTestPage(owner.id);
    const upload = await uploadImage(app, session.Cookie, page.id, 'rollback-safe.png');

    try {
      await expect(
        db.transaction(async (tx) => {
          const filenames = await purgeUnreferencedUploadsForPages(tx, [page.id]);
          expect(filenames).toEqual([upload.filename]);
          throw new Error('force transaction rollback');
        }),
      ).rejects.toThrow('force transaction rollback');

      const retained = await query<{ queued: string; refs: string; uploads: string }>(
        `select
           (select count(*) from uploads where filename = $1)::text as uploads,
           (select count(*)
            from upload_page_refs upr
            join uploads u on u.id = upr.upload_id
            where u.filename = $1)::text as refs,
           (select count(*) from upload_deletion_queue where filename = $1)::text as queued`,
        [upload.filename],
      );
      expect(retained.rows[0]).toEqual({ uploads: '1', refs: '1', queued: '0' });
      expect(await fileExists(upload.filePath)).toBe(true);
      const download = await app.request(upload.url, { headers: { Cookie: session.Cookie } });
      expect(download.status).toBe(200);
    } finally {
      await removeTestFiles([upload.filePath]);
    }
  });

  it('persists a failed file deletion and removes it on a later retry', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const session = await createTestSession(owner.id);
    const page = await createTestPage(owner.id);
    const upload = await uploadImage(app, session.Cookie, page.id, 'retry-cleanup.png');

    try {
      await trashPage(app, session.Cookie, page.id);
      await db.transaction(async (tx) => {
        await purgeUnreferencedUploadsForPages(tx, [page.id]);
        await executeQuery(tx, sql`delete from pages where id = ${page.id} and is_deleted = true`);
      });

      const failed = await processUploadDeletionQueue(db, async () => {
        const error = new Error('simulated unlink failure') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      });
      expect(failed).toEqual({ failed: 1, processed: 0 });
      expect(await fileExists(upload.filePath)).toBe(true);
      const inaccessible = await app.request(upload.url, { headers: { Cookie: session.Cookie } });
      expect(inaccessible.status).toBe(404);

      const queued = await query<{ attempts: number; last_error: string }>(
        `select attempts, last_error
         from upload_deletion_queue
         where filename = $1`,
        [upload.filename],
      );
      expect(queued.rows[0]).toEqual({ attempts: 1, last_error: 'simulated unlink failure' });

      await query('update upload_deletion_queue set delete_after = now() where filename = $1', [
        upload.filename,
      ]);
      const retried = await processUploadDeletionQueue();
      expect(retried).toEqual({ failed: 0, processed: 1 });
      expect(await fileExists(upload.filePath)).toBe(false);
      const remaining = await query<{ count: string }>(
        'select count(*)::text as count from upload_deletion_queue where filename = $1',
        [upload.filename],
      );
      expect(remaining.rows[0]?.count).toBe('0');
    } finally {
      await removeTestFiles([upload.filePath]);
    }
  });

  it('rotates failed cleanup jobs behind untouched jobs', async () => {
    const prefix = `cleanup-fairness-${crypto.randomUUID()}`;
    const filenames = [`${prefix}-1`, `${prefix}-2`, `${prefix}-3`];
    await query(
      `insert into upload_deletion_queue (filename, created_at, updated_at)
       values ($1, now() - interval '3 minutes', now() - interval '3 minutes'),
              ($2, now() - interval '2 minutes', now() - interval '2 minutes'),
              ($3, now() - interval '1 minute', now() - interval '1 minute')`,
      filenames,
    );

    try {
      const firstAttempt = await processUploadDeletionQueue(
        db,
        async () => {
          throw new Error('simulated persistent failure');
        },
        2,
      );
      expect(firstAttempt).toEqual({ failed: 2, processed: 0 });

      const attemptedFilenames: string[] = [];
      const secondAttempt = await processUploadDeletionQueue(
        db,
        async (filename) => {
          attemptedFilenames.push(filename);
        },
        1,
      );
      expect(secondAttempt).toEqual({ failed: 0, processed: 1 });
      expect(attemptedFilenames).toEqual([filenames[2]]);

      const remaining = await query<{ filename: string }>(
        `select filename
         from upload_deletion_queue
         where filename = any($1::text[])
         order by filename`,
        [filenames],
      );
      expect(remaining.rows.map((row) => row.filename)).toEqual(filenames.slice(0, 2));
    } finally {
      await query('delete from upload_deletion_queue where filename = any($1::text[])', [
        filenames,
      ]);
    }
  });
});
