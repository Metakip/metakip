import { useMutation, useQueryClient } from '@tanstack/react-query';
import { showSuccessToast } from '../utils/toast';

type EmptyAllTrashResult = {
  deleted: true;
  folders: number;
  pages: number;
};

async function emptyAllTrash(): Promise<EmptyAllTrashResult> {
  const res = await fetch('/api/trash/empty-all', { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to empty trash' }));
    throw new Error(error.message);
  }
  return res.json();
}

export function useEmptyAllTrash() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: emptyAllTrash,
    onSuccess: () => {
      for (const queryKey of [
        ['trashFolders'],
        ['trashPages'],
        ['folderTree'],
        ['pageTree'],
        ['pages', 'recent'],
        ['stars'],
        ['shared-with-me'],
      ]) {
        queryClient.invalidateQueries({ queryKey });
      }
      showSuccessToast('Trash emptied');
    },
    meta: { errorMessage: 'Failed to empty trash' },
  });
}
