import {
  type CommentAnchor,
  type PageCommentThread,
  pageCommentThreadResponseSchema,
} from '@metakip/shared';
import type { QueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';

export const pageCommentsQueryKey = (pageId: string) => ['pageComments', pageId] as const;
export const pageCommentHighlightsQueryKey = (pageId: string | undefined) =>
  ['pageCommentHighlights', pageId, 'open'] as const;

function parseThread(response: unknown): PageCommentThread {
  return pageCommentThreadResponseSchema.parse(response).thread;
}

export async function createPageComment(
  pageId: string,
  body: string,
  anchor: CommentAnchor,
): Promise<PageCommentThread> {
  const response = await apiFetch<unknown>(`/v1/pages/${pageId}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, anchor }),
  });
  return parseThread(response);
}

export async function updatePageComment(
  pageId: string,
  commentId: string,
  body: string,
): Promise<PageCommentThread> {
  const response = await apiFetch<unknown>(`/v1/pages/${pageId}/comments/${commentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return parseThread(response);
}

export async function deletePageComment(
  pageId: string,
  commentId: string,
): Promise<PageCommentThread> {
  const response = await apiFetch<unknown>(`/v1/pages/${pageId}/comments/${commentId}`, {
    method: 'DELETE',
  });
  return parseThread(response);
}

export async function replyToPageCommentThread(
  pageId: string,
  threadId: string,
  body: string,
): Promise<PageCommentThread> {
  const response = await apiFetch<unknown>(`/v1/pages/${pageId}/comments/${threadId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return parseThread(response);
}

export async function setPageCommentThreadStatus(
  pageId: string,
  threadId: string,
  status: 'open' | 'resolved',
): Promise<PageCommentThread> {
  const response = await apiFetch<unknown>(`/v1/pages/${pageId}/comments/${threadId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return parseThread(response);
}

export async function invalidatePageCommentQueries(
  queryClient: QueryClient,
  pageId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: pageCommentHighlightsQueryKey(pageId) }),
    queryClient.invalidateQueries({ queryKey: pageCommentsQueryKey(pageId) }),
  ]);
}
