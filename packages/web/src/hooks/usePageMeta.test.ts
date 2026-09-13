import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  applyPageMetaStatelessMessage,
  parsePageMetaStatelessMessage,
  refreshPageMetaQueriesAfterSync,
} from './usePageMeta';

describe('refreshPageMetaQueriesAfterSync', () => {
  it('replaces an older initial request before it can hide a startup grant', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let resolveInitialRequest: ((value: string[]) => void) | undefined;
    const queryFn = vi
      .fn<() => Promise<string[]>>()
      .mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            resolveInitialRequest = resolve;
          }),
      )
      .mockResolvedValueOnce(['new grant']);
    const observer = new QueryObserver(queryClient, {
      queryKey: ['shared-with-me'],
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledOnce());
    await refreshPageMetaQueriesAfterSync(queryClient);

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(['shared-with-me'])).toEqual(['new grant']);

    resolveInitialRequest?.(['older empty result']);
    await Promise.resolve();
    expect(queryClient.getQueryData(['shared-with-me'])).toEqual(['new grant']);

    unsubscribe();
    queryClient.clear();
  });
});

describe('parsePageMetaStatelessMessage', () => {
  it('accepts valid workspace membership events', () => {
    expect(
      parsePageMetaStatelessMessage(
        JSON.stringify({
          type: 'workspace_membership_event',
          action: 'role_changed',
          ownerId: 'workspace-owner',
        }),
      ),
    ).toEqual({
      type: 'workspace_membership_event',
      action: 'role_changed',
      ownerId: 'workspace-owner',
    });
    expect(
      parsePageMetaStatelessMessage(
        JSON.stringify({
          type: 'workspace_membership_event',
          action: 'member_removed',
          ownerId: 'workspace-owner',
          refreshViaAccessVersion: true,
        }),
      ),
    ).toEqual({
      type: 'workspace_membership_event',
      action: 'member_removed',
      ownerId: 'workspace-owner',
      refreshViaAccessVersion: true,
    });
  });

  it('accepts share access and grant events', () => {
    expect(
      parsePageMetaStatelessMessage(
        JSON.stringify({
          type: 'share_access_event',
          action: 'revoke',
          entityType: 'folder',
          entityId: 'folder-1',
        }),
      ),
    ).toEqual({
      type: 'share_access_event',
      action: 'revoke',
      entityType: 'folder',
      entityId: 'folder-1',
    });
    expect(
      parsePageMetaStatelessMessage(
        JSON.stringify({
          type: 'grant_received',
          entityType: 'page',
          entityId: 'page-1',
          entityTitle: 'Shared page',
          sharedByName: 'Owner',
        }),
      ),
    ).toEqual({
      type: 'grant_received',
      entityType: 'page',
      entityId: 'page-1',
      entityTitle: 'Shared page',
      sharedByName: 'Owner',
    });
    expect(
      parsePageMetaStatelessMessage(
        JSON.stringify({
          type: 'grant_received',
          entityType: 'folder',
          entityId: 'folder-1',
          entityTitle: 'Shared folder',
          sharedByName: 'Owner',
          refreshViaAccessVersion: true,
        }),
      ),
    ).toEqual({
      type: 'grant_received',
      entityType: 'folder',
      entityId: 'folder-1',
      entityTitle: 'Shared folder',
      sharedByName: 'Owner',
      refreshViaAccessVersion: true,
    });
  });

  it('accepts folder deletion events', () => {
    expect(
      parsePageMetaStatelessMessage(
        JSON.stringify({
          type: 'entity_deleted',
          entityType: 'folder',
          entityId: 'folder-1',
        }),
      ),
    ).toEqual({ type: 'entity_deleted', entityType: 'folder', entityId: 'folder-1' });
  });

  it('removes deleted folder details and redirects the active folder route', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    queryClient.setQueryData(['folders', 'detail', 'folder-1'], { id: 'folder-1' });
    queryClient.setQueryData(['shares', 'folder', 'folder-1'], { id: 'folder-1' });

    const shouldRedirect = applyPageMetaStatelessMessage(
      { type: 'entity_deleted', entityType: 'folder', entityId: 'folder-1' },
      queryClient,
      '/folder/deleted-folder-folder-1',
    );

    expect(shouldRedirect).toBe(true);
    expect(queryClient.getQueryData(['folders', 'detail', 'folder-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['shares', 'folder', 'folder-1'])).toBeUndefined();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pages', 'detail'] });
  });

  it('does not duplicate grant refreshes already delivered by accessVersion', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyPageMetaStatelessMessage(
      {
        type: 'grant_received',
        entityType: 'page',
        entityId: 'page-1',
        entityTitle: 'Shared page',
        sharedByName: 'Owner',
        refreshViaAccessVersion: true,
      },
      queryClient,
      '/',
    );

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('refreshes grants from servers without accessVersion delivery', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyPageMetaStatelessMessage(
      {
        type: 'grant_received',
        entityType: 'page',
        entityId: 'page-1',
        entityTitle: 'Shared page',
        sharedByName: 'Owner',
      },
      queryClient,
      '/',
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shared-with-me'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pageTree'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['folderTree'] });
  });

  it('does not duplicate compatibility refreshes delivered by accessVersion', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyPageMetaStatelessMessage(
      {
        type: 'workspace_membership_event',
        action: 'member_removed',
        ownerId: 'owner-1',
        refreshViaAccessVersion: true,
      },
      queryClient,
      '/settings',
    );

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('refreshes open page permissions and sharing lists after access changes', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyPageMetaStatelessMessage(
      {
        type: 'share_access_event',
        action: 'revoke',
        entityType: 'page',
        entityId: 'page-1',
      },
      queryClient,
      '/page-page-1',
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['pages', 'detail'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shares'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shared-with-me'] });
    expect(
      invalidateSpy.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === 'shares'),
    ).toHaveLength(1);
    expect(
      invalidateSpy.mock.calls.filter(
        ([filters]) => filters?.queryKey?.[0] === 'pageCollaborators',
      ),
    ).toHaveLength(1);
  });

  it('refreshes the owner member list after workspace membership changes', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    applyPageMetaStatelessMessage(
      {
        type: 'workspace_membership_event',
        action: 'member_removed',
        ownerId: 'owner-1',
      },
      queryClient,
      '/settings',
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspace-members'] });
  });

  it('can defer access-query refreshes during a bulk removal', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    queryClient.setQueryData(['folders', 'detail', 'folder-1'], { id: 'folder-1' });

    applyPageMetaStatelessMessage(
      { type: 'entity_deleted', entityType: 'folder', entityId: 'folder-1' },
      queryClient,
      '/',
      true,
    );

    expect(queryClient.getQueryData(['folders', 'detail', 'folder-1'])).toBeUndefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('ignores unrelated non-JSON provider messages', () => {
    expect(parsePageMetaStatelessMessage('provider-control-message')).toBeNull();
  });

  it('reports malformed Metakip JSON instead of silently ignoring it', () => {
    expect(() => parsePageMetaStatelessMessage('{"type":"workspace_membership_event"')).toThrow(
      'Malformed stateless message',
    );
    expect(() =>
      parsePageMetaStatelessMessage(
        JSON.stringify({ type: 'workspace_membership_event', action: 'unknown' }),
      ),
    ).toThrow('Malformed workspace membership event');
    expect(() =>
      parsePageMetaStatelessMessage(
        JSON.stringify({ type: 'entity_deleted', entityType: 'folder' }),
      ),
    ).toThrow('Malformed folder deletion event');
    expect(() =>
      parsePageMetaStatelessMessage(
        JSON.stringify({
          type: 'share_access_event',
          action: 'unknown',
          entityType: 'page',
          entityId: 'page-1',
        }),
      ),
    ).toThrow('Malformed share access event');
    expect(() =>
      parsePageMetaStatelessMessage(
        JSON.stringify({
          type: 'grant_received',
          entityType: 'page',
          entityId: 'page-1',
        }),
      ),
    ).toThrow('Malformed grant event');
  });
});
