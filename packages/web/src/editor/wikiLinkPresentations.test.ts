import { describe, expect, it, vi } from 'vitest';
import {
  registerWikiLinkPresentationResolver,
  subscribeToWikiLinkPresentation,
} from './wikiLinkPresentations';

describe('wiki-link presentation lifecycle', () => {
  it('discards cached entries after their last listener unsubscribes', async () => {
    const view = {};
    const resolver = vi.fn(async (requests: Array<{ key: string }>) =>
      requests.map(({ key }) => ({
        key,
        state: 'accessible' as const,
        target: { id: 'page-1', title: 'Page one' },
      })),
    );
    const unregisterResolver = registerWikiLinkPresentationResolver(view, resolver);
    const firstListener = vi.fn();
    const unsubscribe = subscribeToWikiLinkPresentation(
      view,
      { targetId: 'page-1' },
      firstListener,
    );
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    unsubscribe();

    const secondListener = vi.fn();
    const unsubscribeAgain = subscribeToWikiLinkPresentation(
      view,
      { targetId: 'page-1' },
      secondListener,
    );

    expect(secondListener).toHaveBeenCalledWith({ state: 'loading' });
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(2));
    unsubscribeAgain();
    unregisterResolver();
  });
});
