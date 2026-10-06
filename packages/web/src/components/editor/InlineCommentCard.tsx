import { COMMENT_BODY_MAX_LENGTH, type PageComment, type PageCommentThread } from '@metakip/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getInitial } from '../../utils/avatar';
import {
  deletePageComment,
  invalidatePageCommentQueries,
  replyToPageCommentThread,
  setPageCommentThreadStatus,
  updatePageComment,
} from '../../utils/pageCommentMutations';
import { KebabMenu } from '../ui/KebabMenu';
import {
  commentCancelButtonClass,
  commentSubmitButtonClass,
  commentTextareaFocusClass,
} from './commentComposerStyles';

type InlineCommentCardProps = {
  pageId: string;
  thread: PageCommentThread;
  anchorKey: string;
  currentUserId: string | null;
  canComment: boolean;
  canModerate: boolean;
  active: boolean;
  onHoverChange: (hovered: boolean) => void;
  onHeightChange: (threadId: string, height: number) => void;
  style: { top: number; right: number };
};

function formatRelativeTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes === 0) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function CommentAvatar({ comment }: { comment: PageComment }) {
  const name = comment.authorName || 'Former user';
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-[10px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
      {comment.authorImage ? (
        <img src={comment.authorImage} alt="" className="h-full w-full object-cover" />
      ) : (
        getInitial(name)
      )}
    </span>
  );
}

export function InlineCommentCard({
  pageId,
  thread,
  anchorKey,
  currentUserId,
  canComment,
  canModerate,
  active,
  onHoverChange,
  onHeightChange,
  style,
}: InlineCommentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [reply, setReply] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (editingCommentId) editInputRef.current?.focus();
  }, [editingCommentId]);

  useEffect(() => {
    if (expanded && editingCommentId === null) replyInputRef.current?.focus();
  }, [editingCommentId, expanded]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const reportHeight = () => onHeightChange(thread.id, card.getBoundingClientRect().height);
    reportHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(reportHeight);
    observer.observe(card);
    return () => observer.disconnect();
  }, [onHeightChange, thread.id]);

  const saveMutation = useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      updatePageComment(pageId, commentId, body),
    onSuccess: () => {
      setEditingCommentId(null);
      setEditBody('');
      return invalidatePageCommentQueries(queryClient, pageId);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deletePageComment(pageId, commentId),
    onSuccess: () => invalidatePageCommentQueries(queryClient, pageId),
  });
  const statusMutation = useMutation({
    mutationFn: (status: 'open' | 'resolved') =>
      setPageCommentThreadStatus(pageId, thread.id, status),
    onSuccess: () => invalidatePageCommentQueries(queryClient, pageId),
  });
  const replyMutation = useMutation({
    mutationFn: (body: string) => replyToPageCommentThread(pageId, thread.id, body),
    onSuccess: () => {
      setReply('');
      return invalidatePageCommentQueries(queryClient, pageId);
    },
  });

  const comments = thread.comments;
  const firstComment = comments[0];
  if (!firstComment) return null;

  const beginEditing = (comment: PageComment) => {
    setEditingCommentId(comment.id);
    setEditBody(comment.body ?? '');
    setExpanded(true);
  };

  const openReplyComposer = () => {
    setExpanded(true);
    if (expanded && editingCommentId === null) replyInputRef.current?.focus();
  };

  const renderCommentBody = (comment: PageComment) => {
    if (comment.deletedAt) {
      return (
        <span className="block cursor-text text-sm italic text-zinc-500">
          This comment was deleted.
        </span>
      );
    }
    if (editingCommentId === comment.id) {
      return (
        <form
          className="mt-2 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (editBody.trim() && !saveMutation.isPending) {
              saveMutation.mutate({ commentId: comment.id, body: editBody.trim() });
            }
          }}
        >
          <textarea
            ref={editInputRef}
            value={editBody}
            maxLength={COMMENT_BODY_MAX_LENGTH}
            onChange={(event) => setEditBody(event.target.value)}
            aria-label="Edit comment"
            className="min-h-16 w-full resize-y rounded-md border border-zinc-300 bg-white p-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => {
                setEditingCommentId(null);
                setEditBody('');
              }}
              className="cursor-pointer rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!editBody.trim() || saveMutation.isPending}
              className="cursor-pointer rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700"
            >
              Save
            </button>
          </div>
        </form>
      );
    }
    return (
      <span
        className={`block cursor-text whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200 ${comment.id === firstComment.id && !expanded ? 'line-clamp-4' : ''}`}
      >
        {comment.body}
      </span>
    );
  };

  const renderMoreButton = (comment: PageComment) => {
    const isAuthor = currentUserId !== null && comment.authorId === currentUserId;
    if (comment.deletedAt || !(isAuthor || canModerate)) return null;
    const items = [
      ...(isAuthor
        ? [
            {
              label: 'Edit',
              onClick: () => beginEditing(comment),
            },
          ]
        : []),
      {
        label: 'Delete',
        disabled: deleteMutation.isPending,
        onClick: () => deleteMutation.mutate(comment.id),
      },
    ];
    return (
      <KebabMenu
        ariaLabel={`More actions for comment by ${comment.authorName || 'Former user'}`}
        triggerClassName="flex h-6 w-6 cursor-pointer items-center justify-center rounded p-0 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        items={items}
      />
    );
  };

  const renderComment = (comment: PageComment, isRoot: boolean) => {
    const authorBlock = (
      <span className="min-w-0 flex-1">
        <span className="block truncate">{comment.authorName || 'Former user'}</span>
        <time
          dateTime={comment.createdAt}
          title={new Date(comment.createdAt).toLocaleString()}
          className="block truncate text-[11px] font-normal text-zinc-500"
        >
          {formatRelativeTimestamp(comment.createdAt)}
          {comment.updatedAt !== comment.createdAt ? ' · edited' : ''}
        </time>
      </span>
    );
    const rootHeader = (
      <button
        type="button"
        aria-expanded={expanded}
        onClick={openReplyComposer}
        className="mb-1 flex w-full min-w-0 cursor-pointer items-center gap-1.5 pr-12 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300"
      >
        <CommentAvatar comment={comment} />
        {authorBlock}
      </button>
    );
    const replyHeader = (
      <div className="mb-1 flex min-w-0 items-center gap-1.5 pr-8 text-xs font-medium text-zinc-700 dark:text-zinc-300">
        <CommentAvatar comment={comment} />
        {authorBlock}
        <div className="absolute right-0 top-0 opacity-0 transition-opacity group-hover/comment:opacity-100 group-focus-within/comment:opacity-100">
          {renderMoreButton(comment)}
        </div>
      </div>
    );

    return (
      <article key={comment.id} className="group/comment relative min-w-0">
        {isRoot ? rootHeader : replyHeader}
        <div className="pl-8">
          {editingCommentId === comment.id ? (
            renderCommentBody(comment)
          ) : (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={openReplyComposer}
              className="block w-full cursor-pointer text-left"
            >
              {renderCommentBody(comment)}
            </button>
          )}
        </div>
      </article>
    );
  };

  const mutationError =
    saveMutation.error ?? deleteMutation.error ?? statusMutation.error ?? replyMutation.error;

  return (
    <article
      ref={cardRef}
      data-comment-anchor-key={anchorKey}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      className={`group absolute top-0 z-20 hidden w-[296px] cursor-pointer rounded-lg border border-zinc-200 p-3 transition-colors lg:block dark:border-zinc-800 ${active ? 'bg-zinc-100 shadow-md dark:bg-zinc-800' : 'bg-white shadow-sm dark:bg-zinc-900'} ${expanded ? 'max-h-[min(70vh,32rem)] overflow-y-auto' : ''}`}
      style={style}
    >
      {expanded && comments.length > 1 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-6 left-[26px] top-6 z-0 border-l border-zinc-300 dark:border-zinc-700"
        />
      )}
      <div className="relative z-10 flex items-start gap-2">
        <div className="min-w-0 flex-1">{renderComment(firstComment, true)}</div>
        <div className="pointer-events-none absolute right-2 top-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <button
            type="button"
            disabled={statusMutation.isPending}
            aria-label={
              thread.status === 'resolved' ? 'Reopen comment thread' : 'Resolve comment thread'
            }
            title={thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
            onClick={() =>
              statusMutation.mutate(thread.status === 'resolved' ? 'open' : 'resolved')
            }
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded p-0 text-zinc-500 hover:bg-zinc-200 disabled:opacity-50 dark:hover:bg-zinc-700"
          >
            {thread.status === 'resolved' ? <RotateCcw size={16} /> : <Check size={16} />}
          </button>
          {renderMoreButton(firstComment)}
        </div>
      </div>
      {comments.length > 1 && (
        <button
          type="button"
          onClick={() => {
            if (expanded) setExpanded(false);
            else openReplyComposer();
          }}
          aria-expanded={expanded}
          className="relative z-10 mt-1 cursor-pointer pl-8 text-left text-[11px] text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          {expanded
            ? 'Hide replies'
            : `${comments.length - 1} ${comments.length === 2 ? 'reply' : 'replies'}`}
        </button>
      )}
      {expanded && (
        <div className="relative z-10 mt-3 space-y-3">
          {comments.slice(1).map((comment) => renderComment(comment, false))}
          {canComment && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (reply.trim() && !replyMutation.isPending) {
                  replyMutation.mutate(reply.trim());
                }
              }}
            >
              <textarea
                ref={replyInputRef}
                value={reply}
                maxLength={COMMENT_BODY_MAX_LENGTH}
                onChange={(event) => setReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (reply.trim() && !replyMutation.isPending) {
                    event.currentTarget.form?.requestSubmit();
                  }
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
                    setExpanded(false);
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
          )}
        </div>
      )}
      {mutationError && (
        <p role="alert" className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          {mutationError instanceof Error ? mutationError.message : 'Could not update comment'}
        </p>
      )}
    </article>
  );
}
