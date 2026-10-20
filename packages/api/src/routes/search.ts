import type { V1SearchSnippet, V1SearchTextMatch } from '@metakip/shared';
import { type SQL, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { query } from '../db/query';
import { requireAuth } from '../middleware/auth';
import {
  createMeilisearchClient,
  type PageSearchHit,
  type SearchEntityType,
  searchDocumentId,
} from '../search/meilisearch';
import { getSearchAccessTokens } from '../search/searchAccessTokens';
import { hydrateSearchResults } from '../search/searchResultHydrator';
import {
  SearchBackendUnavailableError,
  searchAccessibleResults,
  searchFilteredResults,
} from '../search/searchResults';

type SearchResult = {
  type: SearchEntityType;
  id: string;
  title: string;
  icon: string | null;
  breadcrumb: string[];
  path: string[];
  titleMatches?: V1SearchTextMatch[];
  snippet?: V1SearchSnippet;
};

const searchRoute = new Hono();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

searchRoute.use('*', requireAuth);

function parseTagSearch(query: string): {
  textQuery: string;
  tagSlugs: string[];
  hasTagFilter: boolean;
} {
  const tagMatch = query.match(/(?:^|\s)tags:\s*(.+)$/i);
  if (!tagMatch) {
    return { textQuery: query, tagSlugs: [], hasTagFilter: false };
  }

  const tagPart = tagMatch[1] ?? '';
  const textQuery = query.slice(0, tagMatch.index).trim();
  const tagSlugs = tagPart
    .split(',')
    .map((tag) => tag.trim().replace(/^#+/, '').toLowerCase())
    .filter(Boolean)
    .map((tag) => `#${tag}`);

  return { textQuery, tagSlugs: [...new Set(tagSlugs)], hasTagFilter: true };
}

searchRoute.get('/', async (c) => {
  const rawQuery = c.req.query('q')?.trim() ?? '';
  if (!rawQuery) {
    return c.json({ results: [] });
  }

  const user = c.get('user') as { id: string };
  const { textQuery, tagSlugs, hasTagFilter } = parseTagSearch(rawQuery);
  if (hasTagFilter && tagSlugs.length === 0) return c.json({ results: [] });
  const createdAfter = c.req.query('createdAfter');
  const createdBefore = c.req.query('createdBefore');
  const parentId = c.req.query('parentId');
  if (parentId && parentId !== 'root' && !UUID_PATTERN.test(parentId)) {
    throw new HTTPException(400, { message: 'parentId must be a valid UUID or root' });
  }
  const parseDateFilter = (value: string | undefined, field: string): string | undefined => {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new HTTPException(400, { message: `${field} must be a valid date` });
    }
    return parsed.toISOString();
  };
  const normalizedCreatedAfter = parseDateFilter(createdAfter, 'createdAfter');
  const normalizedCreatedBefore = parseDateFilter(createdBefore, 'createdBefore');
  if (
    normalizedCreatedAfter &&
    normalizedCreatedBefore &&
    normalizedCreatedAfter > normalizedCreatedBefore
  ) {
    throw new HTTPException(400, { message: 'createdAfter must not be after createdBefore' });
  }

  const pageFilters: SQL[] = [];
  const folderFilters: SQL[] = [];

  if (normalizedCreatedAfter) {
    pageFilters.push(sql`p.created_at >= ${normalizedCreatedAfter}`);
    folderFilters.push(sql`f.created_at >= ${normalizedCreatedAfter}`);
  }

  if (normalizedCreatedBefore) {
    pageFilters.push(sql`p.created_at <= ${normalizedCreatedBefore}`);
    folderFilters.push(sql`f.created_at <= ${normalizedCreatedBefore}`);
  }

  if (parentId === 'root') {
    pageFilters.push(sql`(
      p.parent_id is null
      or p.parent_id not in (select folder_id from get_enumerable_folder_ids(${user.id}))
    )`);
    folderFilters.push(sql`(
      f.parent_id is null
      or f.parent_id not in (select folder_id from get_enumerable_folder_ids(${user.id}))
    )`);
  } else if (parentId) {
    pageFilters.push(sql`(
      p.parent_id = ${parentId}
      and ${parentId}::uuid in (select folder_id from get_enumerable_folder_ids(${user.id}))
    )`);
    folderFilters.push(sql`(
      f.parent_id = ${parentId}
      and ${parentId}::uuid in (select folder_id from get_enumerable_folder_ids(${user.id}))
    )`);
  }

  if (tagSlugs.length > 0) {
    pageFilters.push(sql`p.id in (
      select c.source_id
      from connections c
      where c.connection_type = 'tag'
        and c.target_slug = any(${sql.param(tagSlugs)}::text[])
      group by c.source_id
      having count(distinct c.target_slug) = ${tagSlugs.length}
    )`);
  }

  const pageWhereClause =
    pageFilters.length > 0 ? sql`and ${sql.join(pageFilters, sql` and `)}` : sql.empty();
  const folderWhereClause =
    folderFilters.length > 0 ? sql`and ${sql.join(folderFilters, sql` and `)}` : sql.empty();
  const loadResults = async (hits: PageSearchHit[]): Promise<SearchResult[]> => {
    const hydrated = await hydrateSearchResults(user.id, hits, {
      pageFilters,
      folderFilters,
      includeFolders: tagSlugs.length === 0,
    });
    return hydrated.map((item): SearchResult => {
      if (item.type === 'page') {
        return {
          type: 'page',
          id: item.row.id,
          title: item.row.title,
          icon: item.row.icon,
          breadcrumb: item.row.folder_path_segments,
          path: [item.row.title],
          ...(item.titleMatches ? { titleMatches: item.titleMatches } : {}),
          ...(item.snippet ? { snippet: item.snippet } : {}),
        };
      }
      const folderSegments = item.row.folder_path_segments;
      return {
        type: 'folder',
        id: item.row.id,
        title: item.row.name,
        icon: item.row.icon,
        breadcrumb: folderSegments.slice(0, -1),
        path: folderSegments,
        ...(item.titleMatches ? { titleMatches: item.titleMatches } : {}),
      };
    });
  };

  if (hasTagFilter && textQuery === '') {
    const taggedPageIds = await query<{ id: string }>(sql`
      select p.id
      from pages p
      where p.is_deleted = false
        and p.id in (select page_id from get_accessible_page_ids(${user.id}))
        ${pageWhereClause}
      order by p.updated_at desc, p.id
      limit 20
    `);
    const hits: PageSearchHit[] = taggedPageIds.rows.map((row) => ({
      id: searchDocumentId('page', row.id),
      type: 'page',
      entityId: row.id,
    }));
    const results = await loadResults(hits);
    return c.json({ results });
  }

  const meilisearch = createMeilisearchClient();
  if (!meilisearch) {
    throw new HTTPException(503, { message: 'Search is temporarily unavailable' });
  }

  let results: SearchResult[];
  const accessTokens = await getSearchAccessTokens(user.id);
  try {
    if (pageFilters.length > 0 || folderFilters.length > 0) {
      const [pageIds, folderIds] = await Promise.all([
        query<{ id: string }>(sql`
          select p.id from pages p
          where p.is_deleted = false
            and p.id in (select page_id from get_accessible_page_ids(${user.id}))
            and exists (
              select 1 from get_effective_page_permission(p.id, ${user.id}) access
              where access.permission is not null
            )
            ${pageWhereClause}
        `),
        tagSlugs.length > 0
          ? Promise.resolve({ rows: [] as { id: string }[] })
          : query<{ id: string }>(sql`
              select f.id from folders f
              where f.is_deleted = false
                and f.id in (select folder_id from get_enumerable_folder_ids(${user.id}))
                and exists (
                  select 1 from get_effective_folder_permission(f.id, ${user.id}) access
                  where access.permission is not null
                )
                ${folderWhereClause}
            `),
      ]);
      const candidateIds = [
        ...pageIds.rows.map((row) => searchDocumentId('page', row.id)),
        ...folderIds.rows.map((row) => searchDocumentId('folder', row.id)),
      ];
      results = await searchFilteredResults(
        meilisearch,
        textQuery,
        accessTokens,
        candidateIds,
        loadResults,
      );
    } else {
      results = await searchAccessibleResults(meilisearch, textQuery, accessTokens, loadResults);
    }
  } catch (error) {
    if (!(error instanceof SearchBackendUnavailableError)) throw error;
    throw new HTTPException(503, {
      message: 'Search is temporarily unavailable',
      cause: error.originalError,
    });
  }

  return c.json({ results });
});

export default searchRoute;
