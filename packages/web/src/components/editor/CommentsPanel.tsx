import {
  COMMENT_BODY_MAX_LENGTH,
  type CommentAnchor,
  type CommentListStatus,
  type PageComment,
  type PageCommentThread,
  pageCommentThreadsResponseSchema,
} from '@metakip/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, MessageSquare, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { commentAnchorKey } from '../../editor/codemirror/commentAnchors';
import { useAuth } from '../../hooks/useAuth';
import { ApiError, apiFetch } from '../../utils/api';
import { getInitial } from '../../utils/avatar';
import {
  createPageComment,
  deletePageComment,
  invalidatePageCommentQueries,
  pageCommentHighlightsQueryKey,
  pageCommentsQueryKey,
  replyToPageCommentThread,
  setPageCommentThreadStatus,
  updatePageComment,
} from '../../utils/pageCommentMutations';
import { Dropdown } from '../ui/FormControls';
import { KebabMenu } from '../ui/KebabMenu';
import {
  commentCancelButtonClass,
  commentSubmitButtonClass,
  commentTextareaFocusClass,
} from './commentComposerStyles';

type CommentsPanelProps = {
  pageId: string;
  selectedAnchor: CommentAnchor | null;
  canModerate: boolean;
  onClose: () => void;
  onClearSelection: () => void;
  activeCommentAnchor?: CommentAnchor | null;
  onCommentAnchorHoverChange?: (anchor: CommentAnchor | null) => void;
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function CommentCard({
  pageId,
  comment,
  currentUserId,
  canModerate,
}: {
  pageId: string;
  comment: PageComment;
  currentUserId: string | null;
  canModerate: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body ?? '');
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (editing) editInputRef.current?.focus();
  }, [editing]);

  const saveMutation = useMutation({
    mutationFn: (nextBody: string) => updatePageComment(pageId, comment.id, nextBody),
    onSuccess: () => {
      setEditing(false);
      return invalidatePageCommentQueries(queryClient, pageId);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deletePageComment(pageId, comment.id),
    onSuccess: () => invalidatePageCommentQueries(queryClient, pageId),
  });
  const isAuthor = currentUserId !== null && comment.authorId === currentUserId;
  const canDelete = isAuthor || canModerate;
  const authorName = comment.authorName || 'Former user';
  const moreActions = !comment.deletedAt && canDelete && !editing && (
    <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/comment:opacity-100 group-focus-within/comment:opacity-100">
      <KebabMenu
        ariaLabel={`More actions for comment by ${authorName}`}
        triggerClassName="cursor-pointer rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        items={[
          ...(isAuthor
            ? [
                {
                  label: 'Edit',
                  onClick: () => setEditing(true),
                },
              ]
            : []),
          {
            label: 'Delete',
            disabled: deleteMutation.isPending,
            onClick: () => deleteMutation.mutate(),
          },
        ]}
      />
    </div>
  );

  return (
    <article className="group/comment relative rounded-lg border border-zinc-200 p-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
      <div className="mb-2 flex min-w-0 items-center gap-2 pr-8">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-[10px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
          {comment.authorImage ? (
            <img src={comment.authorImage} alt="" className="h-full w-full object-cover" />
          ) : (
            getInitial(authorName)
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
            {authorName}
          </p>
          <time
            className="block text-[11px] text-zinc-500"
            dateTime={comment.updatedAt}
            title={formatTimestamp(comment.updatedAt)}
          >
            {formatTimestamp(comment.updatedAt)}
            {comment.updatedAt !== comment.createdAt ? ' · edited' : ''}
          </time>
        </div>
      </div>
      {moreActions}
      {comment.deletedAt ? (
        <p className="text-sm italic text-zinc-500">This comment was deleted.</p>
      ) : editing ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (body.trim() && !saveMutation.isPending) saveMutation.mutate(body.trim());
          }}
        >
          <textarea
            ref={editInputRef}
            value={body}
            maxLength={COMMENT_BODY_MAX_LENGTH}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
              event.preventDefault();
              event.stopPropagation();
              if (body.trim() && !saveMutation.isPending) {
                event.currentTarget.form?.requestSubmit();
              }
            }}
            aria-label="Edit comment"
            className={`min-h-20 w-full resize-y rounded-md border border-zinc-300 bg-white p-2 text-sm text-zinc-900 ${commentTextareaFocusClass} dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100`}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setBody(comment.body ?? '');
                setEditing(false);
              }}
              className={commentCancelButtonClass}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!body.trim() || saveMutation.isPending}
              className={commentSubmitButtonClass}
            >
              Save
            </button>
          </div>
        </form>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">
          {comment.body}
        </p>
      )}
      {(deleteMutation.isError || saveMutation.isError) && (
        <p role="alert" className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          {(deleteMutation.error ?? saveMutation.error)?.message ?? 'Could not update comment'}
        </p>
      )}
    </article>
  );
}

function ThreadCard({
  pageId,
  thread,
  currentUserId,
  canModerate,
  active,
  onAnchorHoverChange,
}: {
  pageId: string;
  thread: PageCommentThread;
  currentUserId: string | null;
  canModerate: boolean;
  active: boolean;
  onAnchorHoverChange?: (anchor: CommentAnchor | null) => void;
}) {
  const [reply, setReply] = useState('');
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: (status: 'open' | 'resolved') =>
      setPageCommentThreadStatus(pageId, thread.id, status),
    onSuccess: () => invalidatePageCommentQueries(queryClient, pageId),
  });
  const replyMutation = useMutation({
    mutationFn: () => replyToPageCommentThread(pageId, thread.id, reply),
    onSuccess: () => {
      setReply('');
      return invalidatePageCommentQueries(queryClient, pageId);
    },
  });
  const anchor = thread.anchor;
  const anchorKey = commentAnchorKey(anchor);
  const anchorQuote =
    anchor.quote.length > 240 ? `${anchor.quote.slice(0, 240).trimEnd()}…` : anchor.quote;

  return (
    <fieldset
      aria-label="Comment thread"
      data-comment-anchor-key={anchorKey}
      className="group/thread relative m-0 min-w-0 space-y-2 border-0 border-b border-zinc-200 p-0 pb-4 last:border-0 dark:border-zinc-800"
      onMouseEnter={() => onAnchorHoverChange?.(anchor)}
      onMouseLeave={(event) => {
        const relatedElement = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        const relatedAnchorKey =
          relatedElement?.closest<HTMLElement>('[data-comment-anchor-key]')?.dataset
            .commentAnchorKey ?? null;
        if (relatedAnchorKey !== anchorKey) onAnchorHoverChange?.(null);
      }}
      onFocusCapture={() => onAnchorHoverChange?.(anchor)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onAnchorHoverChange?.(null);
        }
      }}
    >
      <div className="pr-8">
        <blockquote
          className={`rounded-r border-l-2 border-zinc-400 px-3 py-2 text-xs text-zinc-700 transition-colors dark:border-zinc-600 dark:text-zinc-300 ${active ? 'bg-zinc-200 dark:bg-zinc-800' : 'bg-zinc-100 dark:bg-zinc-900'}`}
        >
          “{anchorQuote}”
        </blockquote>
        {thread.status === 'resolved' && (
          <span className="mt-1 block text-[11px] text-zinc-500">Resolved</span>
        )}
      </div>
      <div className="absolute right-0 top-0 opacity-0 transition-opacity group-hover/thread:opacity-100 group-focus-within/thread:opacity-100">
        <button
          type="button"
          disabled={statusMutation.isPending}
          aria-label={
            thread.status === 'resolved' ? 'Reopen comment thread' : 'Resolve comment thread'
          }
          title={thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
          onClick={() => statusMutation.mutate(thread.status === 'resolved' ? 'open' : 'resolved')}
          className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-zinc-200 disabled:opacity-50 dark:hover:bg-zinc-700"
        >
          {thread.status === 'resolved' ? <RotateCcw size={14} /> : <Check size={14} />}
        </button>
      </div>
      {thread.comments.map((comment) => (
        <CommentCard
          key={comment.id}
          pageId={pageId}
          comment={comment}
          currentUserId={currentUserId}
          canModerate={canModerate}
        />
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (reply.trim() && !replyMutation.isPending) replyMutation.mutate();
        }}
        className="space-y-2"
      >
        <textarea
          value={reply}
          maxLength={COMMENT_BODY_MAX_LENGTH}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
            event.preventDefault();
            event.stopPropagation();
            if (reply.trim() && !replyMutation.isPending) event.currentTarget.form?.requestSubmit();
          }}
          aria-label="Reply to comment thread"
          placeholder="Reply…"
          rows={1}
          className={`min-h-9 w-full resize-y rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 ${commentTextareaFocusClass} dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100`}
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setReply('');
              replyMutation.reset();
            }}
            className={commentCancelButtonClass}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!reply.trim() || replyMutation.isPending}
            className={commentSubmitButtonClass}
          >
            {replyMutation.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
      {(statusMutation.isError || replyMutation.isError) && (
        <p role="alert" className="text-xs text-zinc-600 dark:text-zinc-400">
          {(statusMutation.error ?? replyMutation.error)?.message ?? 'Could not update thread'}
        </p>
      )}
    </fieldset>
  );
}

export function CommentsPanel({
  pageId,
  selectedAnchor,
  canModerate,
  onClose,
  onClearSelection,
  activeCommentAnchor = null,
  onCommentAnchorHoverChange,
}: CommentsPanelProps) {
  const [status, setStatus] = useState<CommentListStatus>('open');
  const [body, setBody] = useState('');
  const { data: session } = useAuth();
  const queryClient = useQueryClient();
  const currentUserId = session?.user?.id ?? null;
  const commentsQueryKey = useMemo(
    () =>
      status === 'open'
        ? pageCommentHighlightsQueryKey(pageId)
        : [...pageCommentsQueryKey(pageId), status],
    [pageId, status],
  );
  const commentsQuery = useInfiniteQuery({
    queryKey: commentsQueryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ status, limit: '100' });
      if (pageParam) params.set('cursor', pageParam);
      return pageCommentThreadsResponseSchema.parse(
        await apiFetch<unknown>(`/v1/pages/${pageId}/comments?${params.toString()}`),
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    ...(status === 'open' ? { staleTime: 15_000 } : {}),
  });
  useEffect(() => {
    if (
      status === 'open' ||
      !commentsQuery.isFetchNextPageError ||
      !(commentsQuery.error instanceof ApiError) ||
      commentsQuery.error.status !== 409
    ) {
      return;
    }
    void queryClient.resetQueries({
      queryKey: commentsQueryKey,
      exact: true,
    });
  }, [
    commentsQuery.error,
    commentsQuery.isFetchNextPageError,
    commentsQueryKey,
    queryClient,
    status,
  ]);
  const createMutation = useMutation({
    mutationFn: () => {
      if (!selectedAnchor) throw new Error('Select text on the page before commenting');
      return createPageComment(pageId, body, selectedAnchor);
    },
    onSuccess: () => {
      setBody('');
      onClearSelection();
      setStatus('open');
      return invalidatePageCommentQueries(queryClient, pageId);
    },
  });
  const threads = commentsQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const errorMessage = (error: unknown) =>
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Request failed';

  return (
    <aside
      aria-label="Comments"
      className="fixed left-[15px] right-[15px] bottom-[15px] z-40 flex h-[min(65vh,38rem)] flex-col rounded-t-[2rem] border-y border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:left-auto lg:top-3 lg:right-[15px] lg:bottom-3 lg:h-auto lg:w-[340px] lg:rounded-[2rem] lg:border-l"
    >
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <MessageSquare size={16} /> Comments
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comments"
          className="cursor-pointer rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X size={16} />
        </button>
      </header>
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        {selectedAnchor && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Comment on selection</span>
            <button
              type="button"
              onClick={onClearSelection}
              className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Clear selection
            </button>
          </div>
        )}
        {selectedAnchor ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (body.trim() && !createMutation.isPending) createMutation.mutate();
            }}
            className="space-y-2"
          >
            <textarea
              value={body}
              maxLength={COMMENT_BODY_MAX_LENGTH}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
                event.preventDefault();
                event.stopPropagation();
                if (body.trim() && !createMutation.isPending) {
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              aria-label="New comment"
              placeholder="Comment on this selection…"
              rows={2}
              className={`w-full resize-y rounded-md border border-zinc-300 bg-white p-2 text-sm text-zinc-900 focus:border-zinc-500 ${commentTextareaFocusClass} dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100`}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setBody('');
                  createMutation.reset();
                }}
                className={commentCancelButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!body.trim() || createMutation.isPending}
                className={commentSubmitButtonClass}
              >
                {createMutation.isPending ? 'Sending…' : 'Comment'}
              </button>
            </div>
            {createMutation.isError && (
              <p role="alert" className="text-xs text-zinc-600 dark:text-zinc-400">
                {errorMessage(createMutation.error)}
              </p>
            )}
          </form>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Select text in the page to start a comment thread.
          </p>
        )}
      </div>
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Discussion</h3>
        <Dropdown
          value={status}
          onChange={setStatus}
          ariaLabel="Comment status filter"
          options={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
          triggerClassName="h-8 px-2 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {commentsQuery.isLoading && <p className="text-sm text-zinc-500">Loading comments…</p>}
        {commentsQuery.isError && (
          <p role="alert" className="text-sm text-zinc-600 dark:text-zinc-400">
            {errorMessage(commentsQuery.error)}
          </p>
        )}
        {!commentsQuery.isLoading && !commentsQuery.isError && threads.length === 0 && (
          <p className="py-6 text-center text-sm text-zinc-500">
            No {status === 'all' ? '' : status} threads yet.
          </p>
        )}
        {threads.map((thread) => (
          <ThreadCard
            key={thread.id}
            pageId={pageId}
            thread={thread}
            currentUserId={currentUserId}
            canModerate={canModerate}
            active={
              activeCommentAnchor !== null &&
              commentAnchorKey(activeCommentAnchor) === commentAnchorKey(thread.anchor)
            }
            {...(onCommentAnchorHoverChange
              ? { onAnchorHoverChange: onCommentAnchorHoverChange }
              : {})}
          />
        ))}
        {commentsQuery.hasNextPage && (
          <button
            type="button"
            disabled={commentsQuery.isFetchingNextPage}
            onClick={() => void commentsQuery.fetchNextPage()}
            className="w-full cursor-pointer rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {commentsQuery.isFetchingNextPage ? 'Loading…' : 'Load more threads'}
          </button>
        )}
      </div>
    </aside>
  );
}
