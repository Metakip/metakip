import { MAX_SEARCH_HITS, type MeilisearchClient, type PageSearchHit } from './meilisearch';

const SEARCH_BATCH_SIZE = 100;
const SEARCH_MAX_RESULTS = 20;
const FILTER_ID_BATCH_SIZE = 2_000;
const FILTER_CONCURRENCY = 4;

type SearchClient = Pick<MeilisearchClient, 'ensurePageIndex' | 'search'>;

export class SearchBackendUnavailableError extends Error {
  constructor(readonly originalError: unknown) {
    super('Meilisearch request failed');
    this.name = 'SearchBackendUnavailableError';
  }
}

async function runMeilisearchOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
  try {
    return await operation();
  } catch (error) {
    throw new SearchBackendUnavailableError(error);
  }
}

/** Pages through Meilisearch candidates and lets each route hydrate/authorize its own results. */
export async function searchAccessibleResults<Result>(
  client: SearchClient,
  textQuery: string,
  accessTokens: readonly string[],
  loadAccessibleResults: (hits: PageSearchHit[]) => Promise<readonly Result[]>,
): Promise<Result[]> {
  await runMeilisearchOperation(() => client.ensurePageIndex());

  const results: Result[] = [];
  let offset = 0;

  while (offset < MAX_SEARCH_HITS && results.length < SEARCH_MAX_RESULTS) {
    const page = await runMeilisearchOperation(() =>
      client.search(textQuery, offset, SEARCH_BATCH_SIZE, accessTokens),
    );
    if (page.hits.length === 0) break;

    const accessible = await loadAccessibleResults(page.hits);
    results.push(...accessible.slice(0, SEARCH_MAX_RESULTS - results.length));
    offset += page.hits.length;
    if (
      page.hits.length < SEARCH_BATCH_SIZE ||
      offset >= Math.min(page.estimatedTotalHits, MAX_SEARCH_HITS)
    ) {
      break;
    }
  }

  return results;
}

/** Pre-authorized IDs keep database filters ahead of ranking, not behind a hit limit. */
export async function searchFilteredResults<Result>(
  client: SearchClient,
  textQuery: string,
  accessTokens: readonly string[],
  documentIds: readonly string[],
  loadAccessibleResults: (hits: PageSearchHit[]) => Promise<readonly Result[]>,
): Promise<Result[]> {
  if (documentIds.length === 0) return [];
  await runMeilisearchOperation(() => client.ensurePageIndex());

  const batches: string[][] = [];
  for (let index = 0; index < documentIds.length; index += FILTER_ID_BATCH_SIZE) {
    batches.push(documentIds.slice(index, index + FILTER_ID_BATCH_SIZE));
  }

  const hits: PageSearchHit[] = [];
  for (let index = 0; index < batches.length; index += FILTER_CONCURRENCY) {
    const pages = await Promise.all(
      batches
        .slice(index, index + FILTER_CONCURRENCY)
        .map((ids) =>
          runMeilisearchOperation(() =>
            client.search(textQuery, 0, SEARCH_MAX_RESULTS, accessTokens, ids),
          ),
        ),
    );
    for (const page of pages) hits.push(...page.hits);
  }

  // Every batch uses the same query/ranking rules. The best 20 of each batch
  // suffice to find the best 20 overall; hydrate more only if access changed.
  hits.sort((left, right) => (right.rankingScore ?? 0) - (left.rankingScore ?? 0));
  const results: Result[] = [];
  for (
    let index = 0;
    index < hits.length && results.length < SEARCH_MAX_RESULTS;
    index += SEARCH_BATCH_SIZE
  ) {
    const accessible = await loadAccessibleResults(hits.slice(index, index + SEARCH_BATCH_SIZE));
    results.push(...accessible.slice(0, SEARCH_MAX_RESULTS - results.length));
  }
  return results;
}
