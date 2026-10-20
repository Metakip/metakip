import { yDocToSearchText } from '@metakip/shared/yjs-helpers';
import type { QueryResultRow } from 'pg';
import { testQuery } from '../db/testQuery';
import { searchDocumentId } from '../search/meilisearch';

type MockPage = QueryResultRow & {
  id: string;
  title: string;
  ydoc: Buffer | null;
  is_deleted: boolean | null;
  access_tokens: string[];
};
type MockFolder = QueryResultRow & {
  id: string;
  name: string;
  is_deleted: boolean | null;
  access_tokens: string[];
};
type MockDocument = {
  id: string;
  type: 'page' | 'folder';
  entityId: string;
  title: string;
  content: string;
  accessTokens: string[];
};

type SearchRequest = {
  q?: unknown;
  offset?: unknown;
  limit?: unknown;
  filter?: unknown;
  highlightPreTag?: unknown;
  highlightPostTag?: unknown;
};

function highlightMatches(text: string, terms: string[], preTag: string, postTag: string): string {
  const lowerText = text.toLowerCase();
  const ranges = terms.flatMap((term) => {
    const start = lowerText.indexOf(term);
    return start === -1 ? [] : [{ start, end: start + term.length }];
  });
  const nonOverlapping = ranges
    .sort((left, right) => left.start - right.start)
    .filter(
      (range, index, ordered) => index === 0 || range.start >= (ordered[index - 1]?.end ?? 0),
    );

  let highlighted = text;
  for (const range of [...nonOverlapping].reverse()) {
    highlighted = `${highlighted.slice(0, range.end)}${postTag}${highlighted.slice(range.end)}`;
    highlighted = `${highlighted.slice(0, range.start)}${preTag}${highlighted.slice(range.start)}`;
  }
  return highlighted;
}

export function installMockMeilisearch(): () => void {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.MEILISEARCH_URL;
  const previousKey = process.env.MEILI_MASTER_KEY;
  process.env.MEILISEARCH_URL = 'http://test-meilisearch.invalid';
  process.env.MEILI_MASTER_KEY = 'test-meilisearch-master-key';

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (!url.startsWith('http://test-meilisearch.invalid')) return originalFetch(input, init);
    if (url.endsWith('/indexes/metakip_pages')) {
      return Response.json({ uid: 'metakip_pages', createdAt: '2026-01-01T00:00:00Z' });
    }
    if (url.includes('/settings')) return Response.json({ taskUid: 1 });
    if (url.endsWith('/tasks/1')) return Response.json({ status: 'succeeded' });
    if (url.endsWith('/search')) {
      const request = JSON.parse(String(init?.body)) as SearchRequest;
      const textQuery = typeof request.q === 'string' ? request.q.trim().toLowerCase() : '';
      const highlightPreTag =
        typeof request.highlightPreTag === 'string' ? request.highlightPreTag : '';
      const highlightPostTag =
        typeof request.highlightPostTag === 'string' ? request.highlightPostTag : '';
      const terms = textQuery.split(/\s+/).filter(Boolean);
      const offset = typeof request.offset === 'number' ? request.offset : 0;
      const limit = typeof request.limit === 'number' ? request.limit : 100;
      const idFilter =
        typeof request.filter === 'string' ? request.filter.match(/\bid IN (\[[^\]]*\])/) : null;
      const allowedIds: unknown = idFilter ? JSON.parse(idFilter[1] ?? '[]') : null;
      const accessFilter =
        typeof request.filter === 'string'
          ? request.filter.match(/\baccessTokens IN (\[[^\]]*\])/)
          : null;
      const allowedTokens: unknown = accessFilter ? JSON.parse(accessFilter[1] ?? '[]') : null;
      const pageResult = await testQuery<MockPage>(
        `select page.id, page.title, page.ydoc, page.is_deleted,
          coalesce((select array_agg(access.access_token)
            from get_page_search_access_tokens(page.id) access), '{}'::text[]) as access_tokens
         from pages page order by page.created_at desc, page.id`,
      );
      const folderResult = await testQuery<MockFolder>(
        `select folder.id, folder.name, folder.is_deleted,
          coalesce((select array_agg(access.access_token)
            from get_folder_search_access_tokens(folder.id) access), '{}'::text[]) as access_tokens
         from folders folder order by folder.created_at desc, folder.id`,
      );
      const documents: MockDocument[] = pageResult.rows.flatMap((page) => {
        if (page.is_deleted) return [];
        let content = '';
        if (page.ydoc && page.ydoc.length > 0) {
          try {
            content = yDocToSearchText(new Uint8Array(page.ydoc));
          } catch {
            content = '';
          }
        }
        return [
          {
            id: searchDocumentId('page', page.id),
            type: 'page',
            entityId: page.id,
            title: page.title,
            content,
            accessTokens: page.access_tokens,
          },
        ];
      });
      documents.push(
        ...folderResult.rows.flatMap((folder) =>
          folder.is_deleted
            ? []
            : [
                {
                  id: searchDocumentId('folder', folder.id),
                  type: 'folder' as const,
                  entityId: folder.id,
                  title: folder.name,
                  content: '',
                  accessTokens: folder.access_tokens,
                },
              ],
        ),
      );
      const matches = documents.filter((document) => {
        if (Array.isArray(allowedIds) && !allowedIds.includes(document.id)) return false;
        if (
          Array.isArray(allowedTokens) &&
          !document.accessTokens.some((token) => allowedTokens.includes(token))
        ) {
          return false;
        }
        const searchableText = `${document.title} ${document.content}`.toLowerCase();
        return (
          !textQuery ||
          searchableText.includes(textQuery) ||
          textQuery.split(/\s+/).every((term) => searchableText.includes(term))
        );
      });
      const hits = matches
        .slice(offset, offset + limit)
        .map(({ id, type, entityId, title, content }) => ({
          id,
          type,
          entityId,
          _rankingScore: 1,
          _formatted: {
            title: highlightMatches(title, terms, highlightPreTag, highlightPostTag),
            content: highlightMatches(content, terms, highlightPreTag, highlightPostTag),
          },
        }));
      return Response.json({ hits, estimatedTotalHits: matches.length });
    }
    throw new Error(`Unexpected mocked Meilisearch request: ${url}`);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.MEILISEARCH_URL;
    else process.env.MEILISEARCH_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MEILI_MASTER_KEY;
    else process.env.MEILI_MASTER_KEY = previousKey;
  };
}
