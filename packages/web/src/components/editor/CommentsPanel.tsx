import { Dialog } from '@base-ui/react/dialog';
import {
  COMMENT_BODY_MAX_LENGTH,
  type CommentAnchor,
  type CommentListStatus,
  type PageComment,
  type PageCommentThread,
  pageCommentThreadsResponseSchema,
} from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
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
import { styles as composerStyles } from './CommentComposer.stylex';
import { commentCardMarker, commentThreadMarker, styles } from './CommentsPanel.stylex';

type CommentsPanelProps = {
  pageId: string;
  isDrawer: boolean;
  selectedAnchor: CommentAnchor | null;
  canModerate: boolean;
  onClose: () => void;
  onClearSelection: () => void;
  onStartSelection?: () => void;
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
    <div {...stylex.props(styles.commentMoreActions)} data-comment-more-actions="">
      <KebabMenu
        ariaLabel={`More actions for comment by ${authorName}`}
        triggerStyle={styles.commentMenuTrigger}
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
    <article {...stylex.props(styles.commentCard, commentCardMarker)} data-comment-card="">
      <div {...stylex.props(styles.commentHeader)}>
        <span {...stylex.props(styles.commentAvatar)}>
          {comment.authorImage ? (
            <img src={comment.authorImage} alt="" {...stylex.props(styles.commentAvatarImage)} />
          ) : (
            getInitial(authorName)
          )}
        </span>
        <div {...stylex.props(styles.commentAuthor)}>
          <p {...stylex.props(styles.commentAuthorName)}>{authorName}</p>
          <time
            {...stylex.props(styles.commentTimestamp)}
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
        <p {...stylex.props(styles.deletedComment)}>This comment was deleted.</p>
      ) : editing ? (
        <form
          {...stylex.props(styles.editForm)}
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
            className={
              stylex.props(composerStyles.textarea, composerStyles.textareaMultiline).className
            }
          />
          <div {...stylex.props(styles.composerActions)}>
            <button
              type="button"
              onClick={() => {
                setBody(comment.body ?? '');
                setEditing(false);
              }}
              className={stylex.props(composerStyles.cancelButton).className}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!body.trim() || saveMutation.isPending}
              className={stylex.props(composerStyles.submitButton).className}
            >
              Save
            </button>
          </div>
        </form>
      ) : (
        <p {...stylex.props(styles.commentBody)}>{comment.body}</p>
      )}
      {(deleteMutation.isError || saveMutation.isError) && (
        <p role="alert" {...stylex.props(styles.errorMessage)}>
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
      {...stylex.props(styles.thread, commentThreadMarker)}
      data-comment-thread=""
      onMouseEnter={() => {
        onAnchorHoverChange?.(anchor);
      }}
      onMouseLeave={(event) => {
        const relatedElement = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        const relatedAnchorKey =
          relatedElement?.closest<HTMLElement>('[data-comment-anchor-key]')?.dataset
            .commentAnchorKey ?? null;
        if (relatedAnchorKey !== anchorKey) onAnchorHoverChange?.(null);
      }}
      onFocusCapture={() => {
        onAnchorHoverChange?.(anchor);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onAnchorHoverChange?.(null);
        }
      }}
    >
      <div {...stylex.props(styles.quoteContainer)}>
        <blockquote
          {...stylex.props(styles.quote, active ? styles.quoteActive : styles.quoteInactive)}
        >
          “{anchorQuote}”
        </blockquote>
        {thread.status === 'resolved' && (
          <span {...stylex.props(styles.resolvedLabel)}>Resolved</span>
        )}
      </div>
      <div {...stylex.props(styles.threadActions)} data-comment-thread-actions="">
        <button
          type="button"
          disabled={statusMutation.isPending}
          aria-label={
            thread.status === 'resolved' ? 'Reopen comment thread' : 'Resolve comment thread'
          }
          title={thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
          onClick={() => statusMutation.mutate(thread.status === 'resolved' ? 'open' : 'resolved')}
          {...stylex.props(styles.threadStatusButton)}
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
        {...stylex.props(composerStyles.form)}
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
          className={
            stylex.props(composerStyles.textarea, composerStyles.textareaCompact).className
          }
        />
        <div {...stylex.props(styles.composerActions)}>
          <button
            type="button"
            onClick={() => {
              setReply('');
              replyMutation.reset();
            }}
            className={stylex.props(composerStyles.cancelButton).className}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!reply.trim() || replyMutation.isPending}
            className={stylex.props(composerStyles.submitButton).className}
          >
            {replyMutation.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
      {(statusMutation.isError || replyMutation.isError) && (
        <p role="alert" {...stylex.props(styles.errorMessage)}>
          {(statusMutation.error ?? replyMutation.error)?.message ?? 'Could not update thread'}
        </p>
      )}
    </fieldset>
  );
}

export function CommentsPanel({
  pageId,
  isDrawer,
  selectedAnchor,
  canModerate,
  onClose,
  onClearSelection,
  onStartSelection,
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

  const panelContent = (
    <>
      <header {...stylex.props(styles.panelHeader)}>
        {isDrawer ? (
          <Dialog.Title className={stylex.props(styles.panelTitle).className}>
            <MessageSquare size={16} /> Comments
          </Dialog.Title>
        ) : (
          <h2 {...stylex.props(styles.panelTitle)}>
            <MessageSquare size={16} /> Comments
          </h2>
        )}
        {isDrawer ? (
          <Dialog.Close
            type="button"
            aria-label="Close comments"
            className={stylex.props(styles.closeButton).className}
          >
            <X size={16} />
          </Dialog.Close>
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            {...stylex.props(styles.closeButton)}
          >
            <X size={16} />
          </button>
        )}
      </header>
      <div {...stylex.props(styles.newCommentSection)}>
        {selectedAnchor && (
          <div {...stylex.props(styles.selectionHeader)}>
            <span {...stylex.props(styles.selectionLabel)}>Comment on selection</span>
            <button
              type="button"
              onClick={onClearSelection}
              {...stylex.props(styles.clearSelectionButton)}
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
            {...stylex.props(composerStyles.form)}
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
              className={
                stylex.props(composerStyles.textarea, composerStyles.textareaMultiline).className
              }
            />
            <div {...stylex.props(styles.composerActions)}>
              <button
                type="button"
                onClick={() => {
                  setBody('');
                  createMutation.reset();
                }}
                className={stylex.props(composerStyles.cancelButton).className}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!body.trim() || createMutation.isPending}
                className={stylex.props(composerStyles.submitButton).className}
              >
                {createMutation.isPending ? 'Sending…' : 'Comment'}
              </button>
            </div>
            {createMutation.isError && (
              <p role="alert" {...stylex.props(styles.errorMessage)}>
                {errorMessage(createMutation.error)}
              </p>
            )}
          </form>
        ) : (
          <div {...stylex.props(styles.selectionHelp)}>
            <p {...stylex.props(styles.selectionPrompt)}>
              Select text in the page to start a comment thread.
            </p>
            {isDrawer && onStartSelection && (
              <button
                type="button"
                onClick={onStartSelection}
                {...stylex.props(styles.selectTextButton)}
              >
                Select text on page
              </button>
            )}
          </div>
        )}
      </div>
      <div {...stylex.props(styles.discussionHeader)}>
        <h3 {...stylex.props(styles.discussionTitle)}>Discussion</h3>
        <Dropdown
          value={status}
          onChange={setStatus}
          ariaLabel="Comment status filter"
          options={[
            { value: 'open', label: 'Open' },
            { value: 'resolved', label: 'Resolved' },
            { value: 'all', label: 'All' },
          ]}
          triggerStyle={styles.statusDropdown}
        />
      </div>
      <div {...stylex.props(styles.threadList)} data-comment-thread-list="">
        {commentsQuery.isLoading && (
          <p {...stylex.props(styles.statusMessage)}>Loading comments…</p>
        )}
        {commentsQuery.isError && (
          <p role="alert" {...stylex.props(styles.statusMessage, styles.statusErrorMessage)}>
            {errorMessage(commentsQuery.error)}
          </p>
        )}
        {!commentsQuery.isLoading && !commentsQuery.isError && threads.length === 0 && (
          <p {...stylex.props(styles.emptyThreads)}>
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
            {...stylex.props(styles.loadMoreButton)}
          >
            {commentsQuery.isFetchingNextPage ? 'Loading…' : 'Load more threads'}
          </button>
        )}
      </div>
    </>
  );

  if (!isDrawer) {
    return (
      <aside aria-label="Comments" {...stylex.props(styles.sidePanel)}>
        {panelContent}
      </aside>
    );
  }

  return (
    <Dialog.Root
      open
      modal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={stylex.props(styles.drawerBackdrop).className} />
        <Dialog.Popup
          initialFocus
          finalFocus
          aria-modal="true"
          className={stylex.props(styles.drawerPanel).className}
        >
          {panelContent}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
