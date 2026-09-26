import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testQuery } from '../../db/testQuery';
import { uploadsDir } from '../../env';
import { createTestApp, createTestPage, createTestSession, createTestUser } from '../../test-utils';
import { MAX_IMAGE_SIZE_BYTES } from '../../utils/image-upload';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const createdFiles: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdFiles.splice(0).map((filename) => rm(path.join(uploadsDir, filename), { force: true })),
  );
});

describe('v1 page image uploads', () => {
  it('returns 401 without session', async () => {
    const app = await createTestApp();
    const response = await app.request(`/api/v1/pages/${crypto.randomUUID()}/images`, {
      method: 'POST',
    });
    expect(response.status).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const app = await createTestApp();
    const response = await app.request(`/api/v1/pages/${crypto.randomUUID()}/images`, {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-token' },
    });
    expect(response.status).toBe(401);
  });

  it('uploads, attaches, and idempotently replays a managed image', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id);
    const request = () => {
      const form = new FormData();
      form.append('file', new File([PNG_BYTES], 'diagram.png', { type: 'image/png' }));
      form.append('alt', 'System diagram');
      return app.request(`/api/v1/pages/${page.id}/images`, {
        method: 'POST',
        headers: { ...session, 'Idempotency-Key': 'upload-system-diagram' },
        body: form,
      });
    };

    const first = await request();
    expect(first.status).toBe(201);
    const uploaded = (await first.json()) as {
      id: string;
      filename: string;
      markdown: string;
      url: string;
    };
    createdFiles.push(uploaded.filename);
    expect(uploaded.markdown).toBe(`![System diagram](${uploaded.url})`);

    const replay = await request();
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ id: uploaded.id, filename: uploaded.filename });

    const idempotencyRecord = await testQuery<{ has_replay_window: boolean }>(
      `select expires_at > now() + interval '23 hours' as has_replay_window
       from api_idempotency_records
       where idempotency_key = $1`,
      ['upload-system-diagram'],
    );
    expect(idempotencyRecord.rows[0]?.has_replay_window).toBe(true);

    const conflictingForm = new FormData();
    conflictingForm.append('file', new File([PNG_BYTES], 'diagram.png', { type: 'image/png' }));
    conflictingForm.append('alt', 'Different diagram');
    const conflict = await app.request(`/api/v1/pages/${page.id}/images`, {
      method: 'POST',
      headers: { ...session, 'Idempotency-Key': 'upload-system-diagram' },
      body: conflictingForm,
    });
    expect(conflict.status).toBe(409);

    const refs = await testQuery<{ count: string }>(
      `select count(*)::text as count
       from upload_page_refs
       where page_id = $1 and upload_id = $2`,
      [page.id, uploaded.id],
    );
    expect(refs.rows[0]?.count).toBe('1');
  });

  it('rejects oversized image bodies before parsing them', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id);
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(MAX_IMAGE_SIZE_BYTES + 512 * 1024)], 'oversized.png', {
        type: 'image/png',
      }),
    );

    const response = await app.request(`/api/v1/pages/${page.id}/images`, {
      method: 'POST',
      headers: session,
      body: form,
    });

    expect(response.status).toBe(413);
  });

  it('rejects missing, unsupported, and disguised image files', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id);
    const upload = (file?: File) => {
      const form = new FormData();
      if (file) form.append('file', file);
      return app.request(`/api/v1/pages/${page.id}/images`, {
        method: 'POST',
        headers: session,
        body: form,
      });
    };

    await expect(upload()).resolves.toMatchObject({ status: 400 });
    await expect(
      upload(new File(['text'], 'note.txt', { type: 'text/plain' })),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      upload(new File(['<script>alert(1)</script>'], 'attack.png', { type: 'image/png' })),
    ).resolves.toMatchObject({ status: 400 });
  });
});
