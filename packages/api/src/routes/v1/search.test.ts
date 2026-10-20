import { markdownToYjsState } from '@metakip/shared/markdown-yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testQuery as query } from '../../db/testQuery';
import { installMockMeilisearch } from '../../test-support/mockMeilisearch';
import {
  createTestApp,
  createTestFolder,
  createTestPage,
  createTestSession,
  createTestUser,
} from '../../test-utils';

describe('v1 unified search', () => {
  let restoreMeilisearch: () => void = () => undefined;

  beforeEach(() => {
    restoreMeilisearch = installMockMeilisearch();
  });

  afterEach(() => {
    restoreMeilisearch();
  });

  it('requires authentication', async () => {
    const app = await createTestApp();

    const response = await app.request('/api/v1/search?q=notes');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Unauthorized' },
    });
  });

  it('returns accessible pages whose titles match the query', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const folder = await createTestFolder(user.id, { name: 'Research' });
    const matchingPage = await createTestPage(user.id, {
      title: 'Project Notes',
      parentId: folder.id,
    });
    await createTestPage(user.id, { title: 'Shopping List' });

    const response = await app.request('/api/v1/search?q=project', {
      headers: session,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          type: 'page',
          id: matchingPage.id,
          title: 'Project Notes',
          parentId: folder.id,
          folderPath: '/Research',
        },
      ],
    });
  });

  it('searches page titles through Meilisearch', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id, { title: 'University' });

    const response = await app.request('/api/v1/search?q=university', {
      headers: session,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: [
        {
          type: 'page',
          id: page.id,
          title: 'University',
          titleMatches: [{ start: 0, end: 10 }],
        },
      ],
    });
    expect(body.data[0]).not.toHaveProperty('snippet');
  });

  it('searches folder names and returns folder results', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const folder = await createTestFolder(user.id, { name: 'Research Archive' });

    const response = await app.request('/api/v1/search?q=research', { headers: session });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        {
          type: 'folder',
          id: folder.id,
          name: 'Research Archive',
          folderPath: '/Research Archive',
        },
      ],
    });
  });

  it('matches page body text as well as titles', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    const page = await createTestPage(user.id, { title: 'Meeting summary' });
    await query('update pages set ydoc = $1 where id = $2', [
      Buffer.from(markdownToYjsState('The quarterly forecast is 42%')),
      page.id,
    ]);

    const response = await app.request('/api/v1/search?q=quarterly%20forecast', {
      headers: session,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [
        {
          type: 'page',
          id: page.id,
          title: 'Meeting summary',
          snippet: {
            text: 'The quarterly forecast is 42%',
            matches: [
              { start: 4, end: 13 },
              { start: 14, end: 22 },
            ],
          },
        },
      ],
    });
  });

  it('does not return deleted or inaccessible pages', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const otherUser = await createTestUser();
    const session = await createTestSession(user.id);
    const deletedPage = await createTestPage(user.id, { title: 'Deleted Notes' });
    await createTestPage(otherUser.id, { title: 'Private Notes' });
    await createTestFolder(otherUser.id, { name: 'Private Notes Folder' });
    await app.request(`/api/pages/${deletedPage.id}`, {
      method: 'DELETE',
      headers: { ...session, Origin: 'http://localhost:5173' },
    });

    const response = await app.request('/api/v1/search?q=notes', {
      headers: session,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });

  it('returns no results for a blank query', async () => {
    const app = await createTestApp();
    const user = await createTestUser();
    const session = await createTestSession(user.id);
    await createTestPage(user.id, { title: 'Notes' });

    const response = await app.request('/api/v1/search?q=', {
      headers: session,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [] });
  });
});
