import type { Folder, FolderTreeNode } from '@metakip/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isBulkRemovalInProgress } from '../utils/bulkRemovalState';
import { useLeaveEntity } from '../utils/entity-actions';
import {
  addCreatedFolderToNavigationCache,
  updateFolderNavigationCache,
} from '../utils/navigationCache';
import { showSuccessToast } from '../utils/toast';

const API_BASE = '/api';

async function fetchFolderTree(): Promise<FolderTreeNode[]> {
  const res = await fetch(`${API_BASE}/folders/tree`);
  if (!res.ok) {
    throw new Error('Failed to fetch folder tree');
  }
  return res.json();
}

async function createFolder(parentId?: string, name?: string): Promise<Folder> {
  const res = await fetch(`${API_BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId, name: name ?? 'New Folder' }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to create folder' }));
    throw new Error(error.message);
  }
  return res.json();
}

async function fetchTrashFolders(): Promise<Folder[]> {
  const res = await fetch(`${API_BASE}/folders/trash`);
  if (!res.ok) {
    throw new Error('Failed to fetch trash folders');
  }
  return res.json();
}

export type RestoreFolderResult = Folder & {
  restoredFolders: number;
  restoredPages: number;
};

export type DeleteFolderTrashResult = {
  deleted: true;
  folders: number;
  pages: number;
};

async function restoreFolder(folderId: string): Promise<RestoreFolderResult> {
  const res = await fetch(`${API_BASE}/folders/${folderId}/restore`, {
    method: 'PATCH',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to restore folder' }));
    throw new Error(error.message);
  }
  return res.json();
}

async function permanentDeleteFolder(folderId: string): Promise<DeleteFolderTrashResult> {
  const res = await fetch(`${API_BASE}/folders/${folderId}/permanent`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ message: 'Failed to permanently delete folder' }));
    throw new Error(error.message);
  }
  return res.json();
}

async function emptyFolderTrash(): Promise<DeleteFolderTrashResult> {
  const res = await fetch(`${API_BASE}/folders/trash/empty-all`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to empty folder trash' }));
    throw new Error(error.message);
  }
  return res.json();
}

export type DeleteFolderResponse = {
  requiresForce?: boolean;
  childFolders?: number;
  childPages?: number;
  message?: string;
  deleted?: boolean;
};

async function updateFolder(
  folderId: string,
  updates: { name?: string; icon?: string | null; parentId?: string | null; position?: string },
): Promise<Folder> {
  const res = await fetch(`${API_BASE}/folders/${folderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to update folder' }));
    throw new Error(error.message);
  }
  return res.json();
}

export function useFolderTree({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['folderTree'],
    queryFn: () => fetchFolderTree(),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

export function useCreateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, name }: { parentId?: string; name?: string }) =>
      createFolder(parentId, name),
    onSuccess: (folder) => {
      addCreatedFolderToNavigationCache(queryClient, folder);
      queryClient.invalidateQueries({ queryKey: ['folderTree'] });
      queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
      queryClient.invalidateQueries({ queryKey: ['folders', 'detail'] });
      showSuccessToast('Folder created');
    },
  });
}

export function useTrashFolders() {
  return useQuery({
    queryKey: ['trashFolders'],
    queryFn: () => fetchTrashFolders(),
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

export function useRestoreFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => restoreFolder(folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folderTree'] });
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['trashFolders'] });
      queryClient.invalidateQueries({ queryKey: ['trashPages'] });
      queryClient.invalidateQueries({ queryKey: ['pages', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
      showSuccessToast('Folder restored');
    },
    meta: { errorMessage: 'Failed to restore folder' },
  });
}

export function usePermanentDeleteFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => permanentDeleteFolder(folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trashFolders'] });
      queryClient.invalidateQueries({ queryKey: ['trashPages'] });
      queryClient.invalidateQueries({ queryKey: ['pages', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      showSuccessToast('Folder permanently deleted');
    },
    meta: { errorMessage: 'Failed to permanently delete folder' },
  });
}

export function useEmptyFolderTrash({ silent = false }: { silent?: boolean } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => emptyFolderTrash(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trashFolders'] });
      queryClient.invalidateQueries({ queryKey: ['trashPages'] });
      queryClient.invalidateQueries({ queryKey: ['pages', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      if (!silent) {
        showSuccessToast('Trash emptied');
      }
    },
    meta: { errorMessage: 'Failed to empty trash' },
  });
}

export function useUpdateFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      folderId,
      updates,
    }: {
      folderId: string;
      updates: { name?: string; icon?: string | null; parentId?: string | null; position?: string };
    }) => updateFolder(folderId, updates),
    onSuccess: (_folder, { folderId, updates }) => {
      updateFolderNavigationCache(queryClient, folderId, updates);
      queryClient.invalidateQueries({ queryKey: ['folderTree'] });
      queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['folders', 'detail', folderId] });
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      showSuccessToast('Folder updated');
    },
  });
}

export function useLeaveFolder() {
  return useLeaveEntity('folder');
}
