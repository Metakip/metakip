import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testQuery } from '../../db/testQuery';
import { createTestApp, createTestPage, createTestSession, createTestUser } from '../../test-utils';

const collaboration = vi.hoisted(() => ({ readPageMarkdown: vi.fn() }));
vi.mock('../../utils/collaborationContentClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/collaborationContentClient')>()),
  ...collaboration,
}));

async function grant(pageId: string, recipientUserId: string, permission: string) {
  await testQuery(
    `insert into shares (entity_type, entity_id, recipient_user_id, permission)
     values ('page', $1, $2, $3)`,
    [pageId, recipientUserId, permission],
  );
}

describe('v1 page comments', () => {
  beforeEach(() => {
    collaboration.readPageMarkdown.mockReset().mockResolvedValue({
      markdown: 'Root comment Please review',
      etag: '"test"',
    });
  });

  it('requires selected text to start a comment thread', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const author = await createTestUser();
    const page = await createTestPage(owner.id);
    const authorSession = await createTestSession(author.id);
    await grant(page.id, author.id, 'commenter');

    const response = await app.request(`/api/v1/pages/${page.id}/comments`, {
      method: 'POST',
      headers: { ...authorSession, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Unanchored comment' }),
    });

    expect(response.status).toBe(400);
    expect(collaboration.readPageMarkdown).not.toHaveBeenCalled();
  });

  it('lists comment threads in document order across cursor pages', async () => {
    collaboration.readPageMarkdown.mockResolvedValue({
      markdown: 'First anchor, then second anchor, then third anchor.',
      etag: '"test"',
    });
    const app = await createTestApp();
    const owner = await createTestUser();
    const commenter = await createTestUser();
    const page = await createTestPage(owner.id);
    const session = await createTestSession(commenter.id);
    await grant(page.id, commenter.id, 'commenter');

    for (const quote of ['third anchor', 'second anchor', 'First anchor']) {
      const create = await app.request(`/api/v1/pages/${page.id}/comments`, {
        method: 'POST',
        headers: { ...session, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: quote, anchor: { quote } }),
      });
      expect(create.status).toBe(201);
    }

    const firstPage = await app.request(`/api/v1/pages/${page.id}/comments?limit=2`, {
      headers: session,
    });
    expect(firstPage.status).toBe(200);
    const firstPageBody = (await firstPage.json()) as {
      data: Array<{ comments: Array<{ body: string | null }> }>;
      nextCursor: string | null;
    };
    expect(firstPageBody.data.map((thread) => thread.comments[0]?.body)).toEqual([
      'First anchor',
      'second anchor',
    ]);
    expect(firstPageBody.nextCursor).toBeTruthy();

    const secondPage = await app.request(
      `/api/v1/pages/${page.id}/comments?limit=2&cursor=${firstPageBody.nextCursor}`,
      { headers: session },
    );
    expect(secondPage.status).toBe(200);
    const secondPageBody = (await secondPage.json()) as {
      data: Array<{ comments: Array<{ body: string | null }> }>;
      nextCursor: string | null;
    };
    expect(secondPageBody.data.map((thread) => thread.comments[0]?.body)).toEqual(['third anchor']);
    expect(secondPageBody.nextCursor).toBeNull();
  });

  it('rejects a cursor when page content changes between comment pages', async () => {
    const markdown = 'First anchor, then second anchor.';
    collaboration.readPageMarkdown.mockResolvedValue({ markdown, etag: '"revision-1"' });
    const app = await createTestApp();
    const owner = await createTestUser();
    const commenter = await createTestUser();
    const page = await createTestPage(owner.id);
    const session = await createTestSession(commenter.id);
    await grant(page.id, commenter.id, 'commenter');

    for (const quote of ['second anchor', 'First anchor']) {
      const create = await app.request(`/api/v1/pages/${page.id}/comments`, {
        method: 'POST',
        headers: { ...session, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: quote, anchor: { quote } }),
      });
      expect(create.status).toBe(201);
    }

    const firstPage = await app.request(`/api/v1/pages/${page.id}/comments?limit=1`, {
      headers: session,
    });
    const firstPageBody = (await firstPage.json()) as { nextCursor: string | null };
    expect(firstPage.status).toBe(200);
    expect(firstPageBody.nextCursor).toBeTruthy();

    collaboration.readPageMarkdown.mockResolvedValueOnce({ markdown, etag: '"revision-2"' });
    const secondPage = await app.request(
      `/api/v1/pages/${page.id}/comments?limit=1&cursor=${firstPageBody.nextCursor}`,
      { headers: session },
    );

    expect(secondPage.status).toBe(409);
  });

  it('continues an open-thread cursor if the last thread is resolved between pages', async () => {
    collaboration.readPageMarkdown.mockResolvedValue({
      markdown: 'First anchor, then second anchor.',
      etag: '"test"',
    });
    const app = await createTestApp();
    const owner = await createTestUser();
    const commenter = await createTestUser();
    const page = await createTestPage(owner.id);
    const session = await createTestSession(commenter.id);
    await grant(page.id, commenter.id, 'commenter');

    for (const quote of ['second anchor', 'First anchor']) {
      const create = await app.request(`/api/v1/pages/${page.id}/comments`, {
        method: 'POST',
        headers: { ...session, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: quote, anchor: { quote } }),
      });
      expect(create.status).toBe(201);
    }

    const firstPage = await app.request(`/api/v1/pages/${page.id}/comments?limit=1`, {
      headers: session,
    });
    const firstPageBody = (await firstPage.json()) as {
      data: Array<{ id: string; comments: Array<{ body: string | null }> }>;
      nextCursor: string | null;
    };
    const firstThread = firstPageBody.data[0];
    const cursor = firstPageBody.nextCursor;
    expect(firstThread?.comments[0]?.body).toBe('First anchor');
    if (!firstThread || !cursor) throw new Error('Expected a first comment page and cursor');

    const resolve = await app.request(
      `/api/v1/pages/${page.id}/comments/${firstThread.id}/status`,
      {
        method: 'PATCH',
        headers: { ...session, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      },
    );
    expect(resolve.status).toBe(200);

    const secondPage = await app.request(
      `/api/v1/pages/${page.id}/comments?limit=1&cursor=${cursor}`,
      { headers: session },
    );
    expect(secondPage.status).toBe(200);
    const secondPageBody = (await secondPage.json()) as {
      data: Array<{ comments: Array<{ body: string | null }> }>;
    };
    expect(secondPageBody.data.map((thread) => thread.comments[0]?.body)).toEqual([
      'second anchor',
    ]);
  });

  it('allows commenters to resolve and reopen threads, and keeps replies linear', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const author = await createTestUser();
    const moderator = await createTestUser();
    const viewer = await createTestUser();
    const page = await createTestPage(owner.id);
    const authorSession = await createTestSession(author.id);
    const moderatorSession = await createTestSession(moderator.id);
    const viewerSession = await createTestSession(viewer.id);
    await grant(page.id, author.id, 'commenter');
    await grant(page.id, moderator.id, 'commenter');
    await grant(page.id, viewer.id, 'view');

    const create = await app.request(`/api/v1/pages/${page.id}/comments`, {
      method: 'POST',
      headers: { ...authorSession, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Root comment', anchor: { quote: 'Root comment' } }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      thread: { id: string; comments: Array<{ id: string; body: string | null }> };
    };
    const threadId = created.thread.id;
    const rootCommentId = created.thread.comments[0]?.id;
    expect(rootCommentId).toBeTruthy();

    const resolve = await app.request(`/api/v1/pages/${page.id}/comments/${threadId}/status`, {
      method: 'PATCH',
      headers: { ...moderatorSession, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(resolve.status).toBe(200);
    expect(await resolve.json()).toMatchObject({ thread: { id: threadId, status: 'resolved' } });

    const reply = await app.request(`/api/v1/pages/${page.id}/comments/${threadId}/replies`, {
      method: 'POST',
      headers: { ...moderatorSession, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'A flat reply' }),
    });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({
      thread: {
        id: threadId,
        status: 'open',
        comments: [{ id: rootCommentId, body: 'Root comment' }, { body: 'A flat reply' }],
      },
    });

    const forbiddenEdit = await app.request(`/api/v1/pages/${page.id}/comments/${rootCommentId}`, {
      method: 'PATCH',
      headers: { ...moderatorSession, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Not my comment' }),
    });
    expect(forbiddenEdit.status).toBe(403);

    const viewerRead = await app.request(`/api/v1/pages/${page.id}/comments`, {
      headers: viewerSession,
    });
    expect(viewerRead.status).toBe(403);

    const list = await app.request(`/api/v1/pages/${page.id}/comments?status=all`, {
      headers: { ...authorSession },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ data: [{ id: threadId, status: 'open' }] });
  });

  it('allows admins to delete another user’s comment while commenters cannot', async () => {
    const app = await createTestApp();
    const owner = await createTestUser();
    const author = await createTestUser();
    const commenter = await createTestUser();
    const admin = await createTestUser();
    const page = await createTestPage(owner.id);
    const authorSession = await createTestSession(author.id);
    const commenterSession = await createTestSession(commenter.id);
    const adminSession = await createTestSession(admin.id);
    await grant(page.id, author.id, 'commenter');
    await grant(page.id, commenter.id, 'commenter');
    await grant(page.id, admin.id, 'admin');

    const create = await app.request(`/api/v1/pages/${page.id}/comments`, {
      method: 'POST',
      headers: { ...authorSession, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Please review', anchor: { quote: 'Please review' } }),
    });
    const created = (await create.json()) as { thread: { comments: Array<{ id: string }> } };
    const commentId = created.thread.comments[0]?.id;
    expect(commentId).toBeTruthy();

    const commenterDelete = await app.request(`/api/v1/pages/${page.id}/comments/${commentId}`, {
      method: 'DELETE',
      headers: commenterSession,
    });
    expect(commenterDelete.status).toBe(403);

    const adminDelete = await app.request(`/api/v1/pages/${page.id}/comments/${commentId}`, {
      method: 'DELETE',
      headers: adminSession,
    });
    expect(adminDelete.status).toBe(200);
    expect(await adminDelete.json()).toMatchObject({
      thread: { comments: [{ body: null, deletedAt: expect.any(String) }] },
    });
  });
});
