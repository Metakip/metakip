import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import { requireV1Auth, requireV1OperationScope } from '../../middleware/v1Auth';
import { createMeilisearchClient, type PageSearchHit } from '../../search/meilisearch';
import { getSearchAccessTokens } from '../../search/searchAccessTokens';
import { hydrateSearchResults } from '../../search/searchResultHydrator';
import { SearchBackendUnavailableError, searchAccessibleResults } from '../../search/searchResults';
import { toFolderResponse } from './folders';
import { pageDto } from './pageModel';
import { searchOperation, type searchResultSchema } from './searchContracts';

const searchRoute = new Hono();
searchRoute.use('*', requireV1Auth);
type V1SearchResult = z.infer<typeof searchResultSchema>;

searchRoute.get(searchOperation.routePath, requireV1OperationScope(searchOperation), async (c) => {
  const principal = c.get('v1Principal');
  const textQuery = c.req.query('q')?.trim() ?? '';
  if (!textQuery) return c.json({ data: [] });

  const meilisearch = createMeilisearchClient();
  if (!meilisearch) {
    throw new HTTPException(503, { message: 'Search is temporarily unavailable' });
  }

  const loadResults = async (hits: PageSearchHit[]): Promise<V1SearchResult[]> => {
    const hydrated = await hydrateSearchResults(principal.userId, hits);
    return hydrated.map((item): V1SearchResult => {
      if (item.type === 'page') {
        return {
          type: 'page',
          ...pageDto(item.row),
          folderPath: item.row.folder_path,
          ...(item.titleMatches ? { titleMatches: item.titleMatches } : {}),
          ...(item.snippet ? { snippet: item.snippet } : {}),
        };
      }
      return {
        type: 'folder',
        ...toFolderResponse({
          id: item.row.id,
          parentId: item.row.enumerable_parent_id,
          name: item.row.name,
          icon: item.row.icon,
          ownerId: item.row.owner_id,
          permission: item.row.permission,
          createdAt: item.row.created_at,
          updatedAt: item.row.updated_at,
        }),
        folderPath: item.row.folder_path,
        ...(item.titleMatches ? { titleMatches: item.titleMatches } : {}),
      };
    });
  };

  let results: V1SearchResult[];
  const accessTokens = await getSearchAccessTokens(principal.userId);
  try {
    results = await searchAccessibleResults(meilisearch, textQuery, accessTokens, loadResults);
  } catch (error) {
    if (!(error instanceof SearchBackendUnavailableError)) throw error;
    throw new HTTPException(503, {
      message: 'Search is temporarily unavailable',
      cause: error.originalError,
    });
  }

  return c.json({ data: results });
});

export default searchRoute;
