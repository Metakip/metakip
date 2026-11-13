import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, createWrapper } from '../test-utils/wrapper';

const mocks = vi.hoisted(() => ({
  showSuccessToast: vi.fn(),
}));

vi.mock('../utils/toast', () => ({ showSuccessToast: mocks.showSuccessToast }));

import { useEmptyAllTrash } from './use-trash';

describe('useEmptyAllTrash', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.showSuccessToast.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it('uses the atomic endpoint and refreshes every trash-dependent view', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deleted: true, folders: 2, pages: 3 }),
    });
    const { result } = renderHook(() => useEmptyAllTrash(), {
      wrapper: createWrapper(queryClient),
    });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/trash/empty-all', { method: 'DELETE' });
    for (const queryKey of [
      ['trashFolders'],
      ['trashPages'],
      ['folderTree'],
      ['pageTree'],
      ['pages', 'recent'],
      ['stars'],
      ['shared-with-me'],
    ]) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
    }
    expect(mocks.showSuccessToast).toHaveBeenCalledWith('Trash emptied');
  });
});
