import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, createWrapper } from '../test-utils/wrapper';

const toastMocks = vi.hoisted(() => ({
  showSuccessToast: vi.fn(),
}));

vi.mock('../utils/toast', () => ({
  showSuccessToast: toastMocks.showSuccessToast,
  showErrorToast: vi.fn(),
  showInfoToast: vi.fn(),
}));

import { useLeaveWorkspace } from './use-workspace';

describe('useLeaveWorkspace', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    toastMocks.showSuccessToast.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it('refreshes all workspace-derived navigation after leaving', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: 'Left the workspace' }),
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useLeaveWorkspace(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate({ ownerId: 'owner-1', memberId: 'member-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/members/member-1?workspaceOwnerId=owner-1',
      { method: 'DELETE' },
    );
    for (const queryKey of [
      ['workspace-memberships'],
      ['shared-with-me'],
      ['pageTree'],
      ['folderTree'],
      ['pages', 'recent'],
      ['stars'],
      ['tags'],
    ]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
    expect(toastMocks.showSuccessToast).toHaveBeenCalledWith('Left the workspace');
  });
});
