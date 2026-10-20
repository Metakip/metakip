import { describe, expect, it, vi } from 'vitest';
import { MeilisearchClient, searchDocumentId } from './meilisearch';

describe('MeilisearchClient', () => {
  it('creates and configures the page index once before searching', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    let created = false;
    const fetcher: typeof fetch = vi.fn(async (input, init = {}) => {
      const url = String(input);
      requests.push({ url, init });

      if (url.endsWith('/indexes/metakip_pages') && init.method === undefined) {
        return created
          ? Response.json({ uid: 'metakip_pages', createdAt: '2026-01-01T00:00:00Z' })
          : new Response('not found', { status: 404 });
      }
      if (url.endsWith('/indexes')) {
        created = true;
        return Response.json({ taskUid: 1 });
      }
      if (url.endsWith('/settings')) return Response.json({ taskUid: 2 });
      if (url.endsWith('/settings/pagination')) return Response.json({ taskUid: 3 });
      if (url.includes('/tasks/')) return Response.json({ status: 'succeeded' });
      if (url.endsWith('/search')) {
        const request = JSON.parse(String(init.body)) as {
          highlightPreTag: string;
          highlightPostTag: string;
        };
        return Response.json({
          hits: [
            {
              id: 'page_11111111-1111-1111-1111-111111111111',
              type: 'page',
              entityId: '11111111-1111-1111-1111-111111111111',
              _formatted: {
                title: `${request.highlightPreTag}meeting${request.highlightPostTag} notes`,
                content: `Prep ${request.highlightPreTag}meeting${request.highlightPostTag} ${request.highlightPreTag}notes${request.highlightPostTag} for review`,
              },
            },
            {
              id: 'folder_22222222-2222-2222-2222-222222222222',
              type: 'folder',
              entityId: '22222222-2222-2222-2222-222222222222',
              _formatted: {
                title: `${request.highlightPreTag}meeting${request.highlightPostTag} folder`,
                content: '',
              },
            },
            { id: 42 },
            { title: 'missing id' },
          ],
          estimatedTotalHits: 17,
        });
      }
      throw new Error(`Unexpected Meilisearch request: ${url}`);
    });
    const client = new MeilisearchClient('http://localhost:7700/', 'test-key', fetcher);

    await Promise.all([client.ensurePageIndex(), client.ensurePageIndex()]);
    const result = await client.search('meeting notes', 0, 100, [
      'user:11111111-1111-1111-1111-111111111111',
      'workspace:22222222-2222-2222-2222-222222222222',
    ]);

    expect(result).toEqual({
      hits: [
        {
          id: 'page_11111111-1111-1111-1111-111111111111',
          type: 'page',
          entityId: '11111111-1111-1111-1111-111111111111',
          titleHighlight: {
            text: 'meeting notes',
            matches: [{ start: 0, end: 7 }],
          },
          snippet: {
            text: 'Prep meeting notes for review',
            matches: [
              { start: 5, end: 12 },
              { start: 13, end: 18 },
            ],
          },
        },
        {
          id: 'folder_22222222-2222-2222-2222-222222222222',
          type: 'folder',
          entityId: '22222222-2222-2222-2222-222222222222',
          titleHighlight: {
            text: 'meeting folder',
            matches: [{ start: 0, end: 7 }],
          },
        },
      ],
      estimatedTotalHits: 17,
    });
    expect(requests.filter(({ url }) => url.endsWith('/indexes'))).toHaveLength(1);
    expect(requests.filter(({ url }) => url.endsWith('/settings'))).toHaveLength(1);
    expect(requests.filter(({ url }) => url.endsWith('/settings/pagination'))).toHaveLength(1);
    const settingsRequest = requests.find(
      ({ url, init }) => url.endsWith('/settings') && init.method === 'PATCH',
    );
    expect(JSON.parse(String(settingsRequest?.init.body))).toMatchObject({
      filterableAttributes: ['accessTokens', 'id'],
    });
    expect(requests[0]?.init.headers).toBeInstanceOf(Headers);
    expect(new Headers(requests[0]?.init.headers).get('Authorization')).toBe('Bearer test-key');
    const searchRequest = JSON.parse(String(requests.at(-1)?.init.body)) as Record<string, unknown>;
    expect(searchRequest).toMatchObject({
      q: 'meeting notes',
      offset: 0,
      limit: 100,
      attributesToRetrieve: ['id', 'type', 'entityId'],
      attributesToHighlight: ['title', 'content'],
      attributesToCrop: ['content'],
      cropLength: 18,
      cropMarker: '…',
      matchingStrategy: 'last',
      filter:
        'accessTokens IN ["user:11111111-1111-1111-1111-111111111111", "workspace:22222222-2222-2222-2222-222222222222"]',
    });
    expect(searchRequest.highlightPreTag).toEqual(expect.any(String));
    expect(searchRequest.highlightPostTag).toEqual(expect.any(String));
    expect(searchRequest.highlightPreTag).not.toBe(searchRequest.highlightPostTag);
  });

  it('creates Meilisearch-compatible document identifiers', () => {
    expect(searchDocumentId('page', '11111111-1111-1111-1111-111111111111')).toBe(
      'page_11111111-1111-1111-1111-111111111111',
    );
  });
});
