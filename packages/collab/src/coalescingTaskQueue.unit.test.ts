import type { ShareEventPayload } from '@metakip/shared';
import { describe, expect, it, vi } from 'vitest';
import { createCoalescingTaskQueue } from './coalescingTaskQueue';
import { getShareEventQueueKey, mergeShareEventMetadata } from './notificationRuntime';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

describe('createCoalescingTaskQueue', () => {
  it('keeps only the latest pending task for a key', async () => {
    const firstTask = deferred();
    const handled: string[] = [];
    const queue = createCoalescingTaskQueue<{ key: string; value: string }>({
      maxPending: 4,
      getKey: (task) => task.key,
      handle: async (task) => {
        handled.push(task.value);
        if (task.value === 'first') await firstTask.promise;
      },
      handleOverflow: vi.fn(),
      onError: vi.fn(),
    });

    queue.enqueue({ key: 'first', value: 'first' });
    queue.enqueue({ key: 'same', value: 'stale' });
    queue.enqueue({ key: 'same', value: 'latest' });
    queue.enqueue({ key: 'other', value: 'other' });
    firstTask.resolve();
    await queue.waitForIdle();

    expect(handled).toEqual(['first', 'latest', 'other']);
  });

  it('merges pending tasks with the same key when a merge strategy is provided', async () => {
    const firstTask = deferred();
    const handled: Array<{ key: string; values: string[] }> = [];
    const queue = createCoalescingTaskQueue<{ key: string; values: string[] }>({
      maxPending: 4,
      getKey: (task) => task.key,
      mergePending: (existing, incoming) => ({
        ...incoming,
        values: [...existing.values, ...incoming.values],
      }),
      handle: async (task) => {
        handled.push(task);
        if (task.key === 'first') await firstTask.promise;
      },
      handleOverflow: vi.fn(),
      onError: vi.fn(),
    });

    queue.enqueue({ key: 'first', values: [] });
    queue.enqueue({ key: 'same', values: ['one'] });
    queue.enqueue({ key: 'same', values: ['two'] });
    firstTask.resolve();
    await queue.waitForIdle();

    expect(handled).toEqual([
      { key: 'first', values: [] },
      { key: 'same', values: ['one', 'two'] },
    ]);
  });

  it('retains the latest same-key event queued behind an in-flight handler', async () => {
    const activeTask = deferred();
    const handled: ShareEventPayload[] = [];
    const targetUserId = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const firstMetaUserId = crypto.randomUUID();
    const secondMetaUserId = crypto.randomUUID();
    const queue = createCoalescingTaskQueue<ShareEventPayload>({
      maxPending: 4,
      getKey: getShareEventQueueKey,
      mergePending: mergeShareEventMetadata,
      handle: async (task) => {
        handled.push(task);
        if (task.permission === 'view') await activeTask.promise;
      },
      handleOverflow: vi.fn(),
      onError: vi.fn(),
    });

    queue.enqueue({
      type: 'share_event',
      action: 'grant',
      entityType: 'page',
      entityId: pageId,
      targetUserId,
      permission: 'view',
      message: 'View access granted',
      metaUserIds: [firstMetaUserId],
    });
    queue.enqueue({
      type: 'share_event',
      action: 'update',
      entityType: 'page',
      entityId: pageId,
      targetUserId,
      permission: 'edit',
      message: 'Edit access granted',
      metaUserIds: [secondMetaUserId],
    });
    activeTask.resolve();
    await queue.waitForIdle();

    expect(handled).toHaveLength(2);
    expect(handled[0]).toEqual({
      type: 'share_event',
      action: 'grant',
      entityType: 'page',
      entityId: pageId,
      targetUserId,
      permission: 'view',
      message: 'View access granted',
      metaUserIds: [firstMetaUserId],
    });
    expect(handled[1]).toEqual({
      type: 'share_event',
      action: 'update',
      entityType: 'page',
      entityId: pageId,
      targetUserId,
      permission: 'edit',
      message: 'Edit access granted',
      metaUserIds: [secondMetaUserId],
    });
  });

  it('waits for the active task after stopping and discards pending work', async () => {
    const activeTask = deferred();
    const handled: string[] = [];
    const queue = createCoalescingTaskQueue<{ key: string }>({
      maxPending: 2,
      getKey: (task) => task.key,
      handle: async (task) => {
        handled.push(task.key);
        if (task.key === 'active') await activeTask.promise;
      },
      handleOverflow: vi.fn(),
      onError: vi.fn(),
    });

    queue.enqueue({ key: 'active' });
    queue.enqueue({ key: 'pending' });
    queue.stop();

    let idle = false;
    const idlePromise = queue.waitForIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);

    activeTask.resolve();
    await idlePromise;
    expect(handled).toEqual(['active']);
  });

  it('finishes pending work when draining before shutdown', async () => {
    const activeTask = deferred();
    const handled: string[] = [];
    const queue = createCoalescingTaskQueue<{ key: string }>({
      maxPending: 2,
      getKey: (task) => task.key,
      handle: async (task) => {
        handled.push(task.key);
        if (task.key === 'active') await activeTask.promise;
      },
      handleOverflow: vi.fn(),
      onError: vi.fn(),
    });

    queue.enqueue({ key: 'active' });
    queue.enqueue({ key: 'pending' });
    queue.drainAndStop();
    queue.enqueue({ key: 'ignored' });
    activeTask.resolve();
    await queue.waitForIdle();

    expect(handled).toEqual(['active', 'pending']);
  });

  it('recovers a failed task with a canonical refresh', async () => {
    const handleError = new Error('transient task failure');
    const handle = vi.fn<() => Promise<void>>().mockRejectedValueOnce(handleError);
    const handleOverflow = vi.fn<() => Promise<void>>().mockResolvedValue();
    const onError = vi.fn();
    const queue = createCoalescingTaskQueue<{ key: string }>({
      maxPending: 2,
      getKey: (task) => task.key,
      handle,
      handleOverflow,
      onError,
    });

    queue.enqueue({ key: 'failed' });
    await queue.waitForIdle();

    expect(onError).toHaveBeenCalledWith(handleError);
    expect(handleOverflow).toHaveBeenCalledOnce();
  });

  it('retries a failed canonical refresh without losing overflowed work', async () => {
    const firstTask = deferred();
    const handleOverflow = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce();
    const queue = createCoalescingTaskQueue<{ key: string }>({
      maxPending: 1,
      getKey: (task) => task.key,
      handle: async (task) => {
        if (task.key === 'first') await firstTask.promise;
      },
      handleOverflow,
      onError: vi.fn(),
      overflowRetryDelayMs: 0,
    });

    queue.enqueue({ key: 'first' });
    queue.enqueue({ key: 'pending' });
    queue.enqueue({ key: 'overflow' });
    firstTask.resolve();
    await queue.waitForIdle();

    expect(handleOverflow).toHaveBeenCalledTimes(2);
  });

  it('replaces an oversized backlog with a canonical refresh', async () => {
    const firstTask = deferred();
    const overflowTask = deferred();
    const handled: string[] = [];
    const handleOverflow = vi.fn(async () => overflowTask.promise);
    const queue = createCoalescingTaskQueue<{ key: string }>({
      maxPending: 2,
      getKey: (task) => task.key,
      handle: async (task) => {
        handled.push(task.key);
        if (task.key === 'first') await firstTask.promise;
      },
      handleOverflow,
      onError: vi.fn(),
    });

    queue.enqueue({ key: 'first' });
    queue.enqueue({ key: 'one' });
    queue.enqueue({ key: 'two' });
    queue.enqueue({ key: 'overflow' });
    queue.enqueue({ key: 'covered-by-overflow' });
    firstTask.resolve();

    await vi.waitFor(() => expect(handleOverflow).toHaveBeenCalledTimes(1));
    queue.enqueue({ key: 'after-overflow-started' });
    overflowTask.resolve();
    await queue.waitForIdle();

    expect(handled).toEqual(['first', 'after-overflow-started']);
  });
});
