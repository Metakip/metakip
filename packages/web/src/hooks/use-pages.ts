import {
  type MarkdownImportResult,
  type Page,
  type PageTreeNode,
  parseMarkdownImportResult,
} from '@metakip/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useShareContext } from '../contexts/ShareContext';
import { isBulkRemovalInProgress } from '../utils/bulkRemovalState';
import { useLeaveEntity } from '../utils/entity-actions';
import {
  addCreatedPageToNavigationCache,
  updatePageNavigationCache,
} from '../utils/navigationCache';
import { showInfoToast, showSuccessToast } from '../utils/toast';

const API_BASE = '/api';

async function fetchPageTree(): Promise<PageTreeNode[]> {
  const res = await fetch(`${API_BASE}/pages/tree`);
  if (!res.ok) {
    throw new Error('Failed to fetch page tree');
  }
  return res.json();
}

async function createPage(parentId?: string, title?: string): Promise<Page> {
  const res = await fetch(`${API_BASE}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId, title: title ?? 'Untitled' }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to create page' }));
    throw new Error(error.message);
  }
  return res.json();
}

async function updatePage(
  pageId: string,
  updates: Partial<Page>,
  useGuestEndpoint: boolean,
): Promise<Page> {
  const suffix = useGuestEndpoint ? '/metadata' : '';
  const res = await fetch(`${API_BASE}/pages/${pageId}${suffix}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    throw new Error('Failed to update page');
  }
  return res.json();
}

export interface RecentPage {
  id: string;
  title: string;
  icon: string | null;
  createdBy: string | null;
  ownerId: string | null;
  updatedAt: string | Date;
  visitedAt: string | Date;
}

async function fetchRecentPages(limit: number): Promise<RecentPage[]> {
  const res = await fetch(`${API_BASE}/pages/recent?limit=${limit}`);
  if (!res.ok) {
    throw new Error('Failed to fetch recent pages');
  }
  return res.json();
}

async function fetchTrashPages(): Promise<Page[]> {
  const res = await fetch(`${API_BASE}/pages/trash`);
  if (!res.ok) {
    throw new Error('Failed to fetch trash pages');
  }
  return res.json();
}

async function restorePage(pageId: string): Promise<Page> {
  const res = await fetch(`${API_BASE}/pages/${pageId}/restore`, {
    method: 'PATCH',
  });
  if (!res.ok) {
    throw new Error('Failed to restore page');
  }
  return res.json();
}

async function permanentDeletePage(pageId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/pages/${pageId}/permanent`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Failed to permanently delete page');
  }
}

async function emptyTrash(): Promise<void> {
  const res = await fetch(`${API_BASE}/pages/trash/empty-all`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error('Failed to empty trash');
  }
}

export function useLeavePage() {
  return useLeaveEntity('page');
}

async function movePage(pageId: string, parentId: string | null, position: string): Promise<Page> {
  const res = await fetch(`${API_BASE}/pages/${pageId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId, position }),
  });
  if (!res.ok) {
    throw new Error('Failed to move page');
  }
  return res.json();
}

async function importMarkdown(file: File): Promise<MarkdownImportResult> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/import/markdown`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const error: unknown = await res.json().catch(() => null);
    const message =
      error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : 'Failed to import markdown';
    throw new Error(message);
  }
  return parseMarkdownImportResult(await res.json());
}

export function usePageTree({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['pageTree'],
    queryFn: () => fetchPageTree(),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

export function useRecentPages(limit = 8, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['pages', 'recent', limit],
    queryFn: () => fetchRecentPages(limit),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

export function useCreatePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, title }: { parentId?: string; title?: string; silent?: boolean }) =>
      createPage(parentId, title),
    onSuccess: (newPage, { silent }) => {
      addCreatedPageToNavigationCache(queryClient, newPage);
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
      queryClient.invalidateQueries({ queryKey: ['folders', 'detail'] });
      if (!silent) {
        showSuccessToast('Page created');
      }
    },
  });
}

export function useUpdatePage() {
  const queryClient = useQueryClient();
  const { isAnonymous } = useShareContext();
  return useMutation({
    mutationFn: ({
      pageId,
      updates,
    }: {
      pageId: string;
      updates: Partial<Page>;
      silent?: boolean;
    }) => updatePage(pageId, updates, isAnonymous),
    onSuccess: (_, { pageId, updates, silent }) => {
      updatePageNavigationCache(queryClient, pageId, updates);
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
      queryClient.invalidateQueries({ queryKey: ['pages', 'detail', pageId] });
      queryClient.invalidateQueries({ queryKey: ['pages', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      queryClient.invalidateQueries({ queryKey: ['shares'] });
      if (!silent) {
        showSuccessToast('Page updated');
      }
    },
    meta: { errorMessage: 'Failed to update page' },
  });
}

export function useTrashPages() {
  return useQuery({
    queryKey: ['trashPages'],
    queryFn: () => fetchTrashPages(),
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

export function useRestorePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => restorePage(pageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['trashPages'] });
      queryClient.invalidateQueries({ queryKey: ['pages', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      showSuccessToast('Page restored');
    },
    meta: { errorMessage: 'Failed to restore page' },
  });
}

export function usePermanentDeletePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pageId: string) => permanentDeletePage(pageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trashPages'] });
      queryClient.invalidateQueries({ queryKey: ['pages', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
      showSuccessToast('Page permanently deleted');
    },
    meta: { errorMessage: 'Failed to permanently delete page' },
  });
}

export function useEmptyTrash({ silent = false }: { silent?: boolean } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: () => {
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

export function useMovePage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      pageId,
      parentId,
      position,
    }: {
      pageId: string;
      parentId: string | null;
      position: string;
    }) => movePage(pageId, parentId, position),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
      showSuccessToast('Page moved');
    },
    meta: { errorMessage: 'Failed to move page' },
  });
}

export function useImportMarkdown() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file }: { file: File }) => importMarkdown(file),
    onSuccess: ({ warnings }) => {
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['folderTree'] });
      queryClient.invalidateQueries({ queryKey: ['pages', 'content'] });
      showSuccessToast('Note imported');
      for (const warning of warnings) {
        showInfoToast(warning.message);
      }
    },
  });
}

export function usePages({ enabled = true }: { enabled?: boolean } = {}) {
  const query = usePageTree({ enabled });
  const pages = useMemo(() => {
    const result: Page[] = [];
    const walk = (nodes: PageTreeNode[] | undefined) => {
      if (!nodes) return;
      for (const node of nodes) {
        result.push(node);
        if (node.children && node.children.length > 0) {
          walk(node.children);
        }
      }
    };
    walk(query.data);
    return result;
  }, [query.data]);

  return {
    ...query,
    data: pages,
  };
}
