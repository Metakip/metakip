import { describe, expect, it, vi } from 'vitest';
import type { PageSearchHit } from './meilisearch';
import { searchAccessibleResults, searchFilteredResults } from './searchResults';

function hitsAt(offset: number): PageSearchHit[] {
  return Array.from({ length: 100 }, (_, index) => {
    const entityId = `page-${offset + index}`;
    return { id: `page_${entityId}`, type: 'page', entityId };
  });
}

describe('searchAccessibleResults', () => {
  it('pages through inaccessible candidates, preserving hit order and the result cap', async () => {
    const ensurePageIndex = vi.fn().mockResolvedValue(undefined);
    const search = vi.fn(async (_query: string, offset: number) => ({
      hits: hitsAt(offset),
      estimatedTotalHits: 200,
    }));
    const loadAccessibleResults = vi.fn(async (hits: PageSearchHit[]) =>
      hits[0]?.entityId === 'page-0' ? [] : hits.map((hit) => hit.entityId),
    );

    const results = await searchAccessibleResults(
      { ensurePageIndex, search },
      'notes',
      ['user:test-user'],
      loadAccessibleResults,
    );

    expect(ensurePageIndex).toHaveBeenCalledOnce();
    expect(search.mock.calls.map(([, offset]) => offset)).toEqual([0, 100]);
    expect(results).toEqual(Array.from({ length: 20 }, (_, index) => `page-${100 + index}`));
  });

  it('does not classify result hydration failures as Meilisearch failures', async () => {
    const hydrationError = new Error('database unavailable');
    const client = {
      ensurePageIndex: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ hits: hitsAt(0), estimatedTotalHits: 100 }),
    };

    await expect(
      searchAccessibleResults(client, 'notes', ['user:test-user'], async () => {
        throw hydrationError;
      }),
    ).rejects.toBe(hydrationError);
  });

  it('searches all prefiltered ID batches and merges by ranking score', async () => {
    const search = vi.fn(
      async (
        _query: string,
        _offset: number,
        _limit: number,
        _tokens: readonly string[],
        ids: readonly string[],
      ) => ({
        hits: [
          {
            id: ids[0] ?? '',
            type: 'page' as const,
            entityId: ids[0] ?? '',
            rankingScore: ids[0] === 'page_2000' ? 0.9 : 0.4,
          },
        ],
        estimatedTotalHits: 1,
      }),
    );
    const ids = Array.from({ length: 2_001 }, (_, index) => `page_${index}`);
    const results = await searchFilteredResults(
      { ensurePageIndex: vi.fn().mockResolvedValue('generation'), search },
      'notes',
      ['user:test-user'],
      ids,
      async (hits) => hits.map((hit) => hit.id),
    );

    expect(search).toHaveBeenCalledTimes(2);
    expect(results).toEqual(['page_2000', 'page_0']);
  });
});
