import { randomUUID } from 'node:crypto';
import type { V1SearchSnippet, V1SearchTextMatch } from '@metakip/shared';

export const PAGE_SEARCH_INDEX = 'metakip_pages';
export const MAX_SEARCH_HITS = 10_000;
const INDEX_CHECK_INTERVAL_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SearchEntityType = 'page' | 'folder';

/** Meilisearch IDs allow alphanumeric characters, hyphens, and underscores, but not colons. */
export function searchDocumentId(type: SearchEntityType, entityId: string): string {
  return `${type}_${entityId}`;
}

export type SearchDocument = {
  id: string;
  type: SearchEntityType;
  entityId: string;
  title: string;
  content: string;
  accessTokens: string[];
};

export type SearchTextHighlight = { text: string; matches: V1SearchTextMatch[] };
export type PageSearchHit = {
  id: string;
  type: SearchEntityType;
  entityId: string;
  rankingScore?: number;
  titleHighlight?: SearchTextHighlight;
  snippet?: V1SearchSnippet;
};

type MeilisearchTask = { taskUid?: number; uid?: number };
type MeilisearchTaskStatus = { status?: string; error?: { message?: string } };
type MeilisearchIndex = { createdAt?: string };
type MeilisearchSearchResponse = {
  hits?: unknown;
  estimatedTotalHits?: unknown;
};

export class MeilisearchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MeilisearchError';
  }
}

export class MeilisearchClient {
  private readonly baseUrl: string;
  private initialization: Promise<string> | null = null;
  private isInitializing = false;
  private generation: string | null = null;
  private lastIndexCheck = 0;
  private readonly fetcher: typeof fetch;

  constructor(
    url: string,
    private readonly apiKey: string,
    fetcher?: typeof fetch,
  ) {
    this.baseUrl = url.replace(/\/+$/, '');
    this.fetcher = fetcher ?? ((input, init) => fetch(input, init));
  }

  async ensurePageIndex(): Promise<string> {
    if (
      !this.isInitializing &&
      (!this.initialization || Date.now() - this.lastIndexCheck >= INDEX_CHECK_INTERVAL_MS)
    ) {
      this.isInitializing = true;
      this.initialization = this.initializePageIndex()
        .then((generation) => {
          this.lastIndexCheck = Date.now();
          return generation;
        })
        .catch((error: unknown) => {
          this.initialization = null;
          this.lastIndexCheck = 0;
          throw error;
        })
        .finally(() => {
          this.isInitializing = false;
        });
    }
    if (!this.initialization) throw new Error('Meilisearch index check did not start');
    return this.initialization;
  }

  private async initializePageIndex(): Promise<string> {
    let index: MeilisearchIndex;
    try {
      index = await this.request<MeilisearchIndex>(`/indexes/${PAGE_SEARCH_INDEX}`);
    } catch (error) {
      if (!(error instanceof MeilisearchError) || error.status !== 404) throw error;
      const createTask = await this.request<MeilisearchTask>(`/indexes`, {
        method: 'POST',
        body: JSON.stringify({ uid: PAGE_SEARCH_INDEX, primaryKey: 'id' }),
      });
      await this.waitForTask(createTask);
      index = await this.request<MeilisearchIndex>(`/indexes/${PAGE_SEARCH_INDEX}`);
    }
    if (!index.createdAt) throw new Error('Meilisearch index has no creation timestamp');
    if (this.generation === index.createdAt) return index.createdAt;

    const settingsTask = await this.request<MeilisearchTask>(
      `/indexes/${PAGE_SEARCH_INDEX}/settings`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          searchableAttributes: ['title', 'content'],
          displayedAttributes: ['id', 'type', 'entityId', 'title', 'content'],
          filterableAttributes: ['accessTokens', 'id'],
        }),
      },
    );
    await this.waitForTask(settingsTask);

    const paginationTask = await this.request<MeilisearchTask>(
      `/indexes/${PAGE_SEARCH_INDEX}/settings/pagination`,
      { method: 'PATCH', body: JSON.stringify({ maxTotalHits: MAX_SEARCH_HITS }) },
    );
    await this.waitForTask(paginationTask);
    this.generation = index.createdAt;
    return index.createdAt;
  }

  async upsertDocuments(documents: SearchDocument[]): Promise<void> {
    if (documents.length === 0) return;
    const task = await this.request<MeilisearchTask>(`/indexes/${PAGE_SEARCH_INDEX}/documents`, {
      method: 'POST',
      body: JSON.stringify(documents),
    });
    await this.waitForTask(task);
  }

  async deleteDocuments(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const task = await this.request<MeilisearchTask>(
      `/indexes/${PAGE_SEARCH_INDEX}/documents/delete-batch`,
      { method: 'POST', body: JSON.stringify(ids) },
    );
    await this.waitForTask(task);
  }

  async search(
    query: string,
    offset: number,
    limit: number,
    accessTokens?: readonly string[],
    documentIds?: readonly string[],
  ): Promise<{
    hits: PageSearchHit[];
    estimatedTotalHits: number;
  }> {
    const highlightMarker = randomUUID().replaceAll('-', '');
    const highlightPreTag = `metakipmatch${highlightMarker}start`;
    const highlightPostTag = `metakipmatch${highlightMarker}end`;
    const result = await this.request<MeilisearchSearchResponse>(
      `/indexes/${PAGE_SEARCH_INDEX}/search`,
      {
        method: 'POST',
        body: JSON.stringify({
          q: query,
          offset,
          limit,
          attributesToRetrieve: ['id', 'type', 'entityId'],
          attributesToHighlight: ['title', 'content'],
          attributesToCrop: ['content'],
          cropLength: 18,
          cropMarker: '…',
          highlightPreTag,
          highlightPostTag,
          matchingStrategy: 'last',
          ...(documentIds ? { showRankingScore: true } : {}),
          filter: [
            ...(accessTokens
              ? [
                  `accessTokens IN [${accessTokens.map((token) => JSON.stringify(token)).join(', ')}]`,
                ]
              : []),
            ...(documentIds
              ? [`id IN [${documentIds.map((id) => JSON.stringify(id)).join(', ')}]`]
              : []),
          ].join(' AND '),
        }),
      },
    );
    const hits = Array.isArray(result.hits)
      ? result.hits.flatMap((hit): PageSearchHit[] => {
          if (
            !hit ||
            typeof hit !== 'object' ||
            !('id' in hit) ||
            typeof hit.id !== 'string' ||
            !('entityId' in hit) ||
            typeof hit.entityId !== 'string' ||
            !UUID_PATTERN.test(hit.entityId) ||
            !('type' in hit) ||
            (hit.type !== 'page' && hit.type !== 'folder')
          ) {
            return [];
          }
          if (documentIds && (!('_rankingScore' in hit) || typeof hit._rankingScore !== 'number')) {
            throw new Error('Meilisearch did not return ranking scores for filtered search');
          }
          const titleHighlight = parseHighlightedText(
            getFormattedAttribute(hit, 'title'),
            highlightPreTag,
            highlightPostTag,
          );
          const snippet = parseHighlightedText(
            getFormattedAttribute(hit, 'content'),
            highlightPreTag,
            highlightPostTag,
          );
          return [
            {
              id: hit.id,
              entityId: hit.entityId,
              type: hit.type,
              ...('_rankingScore' in hit && typeof hit._rankingScore === 'number'
                ? { rankingScore: hit._rankingScore }
                : {}),
              ...(titleHighlight ? { titleHighlight } : {}),
              ...(snippet ? { snippet } : {}),
            },
          ];
        })
      : [];
    const estimatedTotalHits =
      typeof result.estimatedTotalHits === 'number' ? result.estimatedTotalHits : hits.length;
    return { hits, estimatedTotalHits };
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.apiKey}`);
    headers.set('Content-Type', 'application/json');
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      if (response.status === 404 && path.startsWith(`/indexes/${PAGE_SEARCH_INDEX}/`)) {
        this.initialization = null;
        this.lastIndexCheck = 0;
      }
      const detail = await response.text().catch(() => '');
      throw new MeilisearchError(
        `Meilisearch request failed (${response.status})${detail ? `: ${detail}` : ''}`,
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async waitForTask(task: MeilisearchTask): Promise<void> {
    const taskUid = task.taskUid ?? task.uid;
    if (typeof taskUid !== 'number') return;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const status = await this.request<MeilisearchTaskStatus>(`/tasks/${taskUid}`);
      if (status.status === 'succeeded') return;
      if (status.status === 'failed' || status.status === 'canceled') {
        throw new Error(status.error?.message ?? `Meilisearch task ${taskUid} ${status.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for Meilisearch task ${taskUid}`);
  }
}

function getFormattedAttribute(hit: object, attribute: string): unknown {
  if (!('_formatted' in hit)) return undefined;
  const formatted = hit._formatted;
  if (typeof formatted !== 'object' || formatted === null || !(attribute in formatted)) {
    return undefined;
  }
  return (formatted as Record<string, unknown>)[attribute];
}

function parseHighlightedText(
  value: unknown,
  preTag: string,
  postTag: string,
): SearchTextHighlight | undefined {
  if (typeof value !== 'string') return undefined;

  const matches: V1SearchTextMatch[] = [];
  let text = '';
  let cursor = 0;
  while (true) {
    const start = value.indexOf(preTag, cursor);
    if (start === -1) break;
    const contentStart = start + preTag.length;
    const end = value.indexOf(postTag, contentStart);
    if (end === -1) break;

    text += value.slice(cursor, start);
    const matchStart = text.length;
    text += value.slice(contentStart, end);
    matches.push({ start: matchStart, end: text.length });
    cursor = end + postTag.length;
  }
  if (matches.length === 0) return undefined;
  text += value.slice(cursor);
  return { text, matches };
}

export function createMeilisearchClient(): MeilisearchClient | null {
  const url = process.env.MEILISEARCH_URL?.trim();
  const apiKey = process.env.MEILI_MASTER_KEY?.trim();
  if (!url || !apiKey) return null;
  const key = `${url}\u0000${apiKey}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const client = new MeilisearchClient(url, apiKey);
  clients.set(key, client);
  return client;
}

const clients = new Map<string, MeilisearchClient>();
