import type { Folder, Page } from '@metakip/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { showSuccessToast } from '../utils/toast';

const API_BASE = '/api';

async function copyPage(pageId: string, parentId?: string | null): Promise<Page> {
  const res = await fetch(`${API_BASE}/pages/${pageId}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to copy page' }));
    throw new Error(error.message);
  }
  return res.json();
}

type FolderCopyResult = Folder & { skippedRestrictedItems?: boolean };

async function copyFolder(folderId: string, parentId?: string | null): Promise<FolderCopyResult> {
  const res = await fetch(`${API_BASE}/folders/${folderId}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to copy folder' }));
    throw new Error(error.message);
  }
  return res.json();
}

export function useCopyPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pageId, parentId }: { pageId: string; parentId?: string | null }) =>
      copyPage(pageId, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['folders', 'detail'] });
      showSuccessToast('Page copied');
    },
  });
}

export function useCopyFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, parentId }: { folderId: string; parentId?: string | null }) =>
      copyFolder(folderId, parentId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['folderTree'] });
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['folders', 'detail'] });
      showSuccessToast(
        data.skippedRestrictedItems
          ? 'Folder copied. Some restricted items were skipped.'
          : 'Folder copied',
      );
    },
  });
}
