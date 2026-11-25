import { COMMENT_BODY_MAX_LENGTH, type PageComment, type PageCommentThread } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
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
import { styles as composerStyles } from './CommentComposer.stylex';
import {
  inlineCommentArticleMarker,
  inlineCommentCardMarker,
  styles,
} from './InlineCommentCard.stylex';

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
    <span {...stylex.props(styles.avatar)}>
      {comment.authorImage ? (
        <img src={comment.authorImage} alt="" {...stylex.props(styles.avatarImage)} />
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
      return <span {...stylex.props(styles.deletedComment)}>This comment was deleted.</span>;
    }
    if (editingCommentId === comment.id) {
      return (
        <form
          {...stylex.props(styles.editForm)}
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
            {...stylex.props(styles.editTextarea)}
          />
          <div {...stylex.props(styles.editActions)}>
            <button
              type="button"
              onClick={() => {
                setEditingCommentId(null);
                setEditBody('');
              }}
              {...stylex.props(styles.cancelEditButton)}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!editBody.trim() || saveMutation.isPending}
              {...stylex.props(styles.saveEditButton)}
            >
              Save
            </button>
          </div>
        </form>
      );
    }
    return (
      <span
        {...stylex.props(
          styles.commentBody,
          comment.id === firstComment.id && !expanded && styles.commentBodyClamped,
        )}
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
        triggerStyle={styles.menuTrigger}
        items={items}
      />
    );
  };

  const renderComment = (comment: PageComment, isRoot: boolean) => {
    const authorBlock = (
      <span {...stylex.props(styles.authorBlock)}>
        <span {...stylex.props(styles.authorName)}>{comment.authorName || 'Former user'}</span>
        <time
          dateTime={comment.createdAt}
          title={new Date(comment.createdAt).toLocaleString()}
          {...stylex.props(styles.timestamp)}
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
        {...stylex.props(styles.rootHeader)}
      >
        <CommentAvatar comment={comment} />
        {authorBlock}
      </button>
    );
    const replyHeader = (
      <div {...stylex.props(styles.replyHeader)}>
        <CommentAvatar comment={comment} />
        {authorBlock}
        <div {...stylex.props(styles.replyMenuActions)} data-inline-reply-menu-actions="">
          {renderMoreButton(comment)}
        </div>
      </div>
    );

    return (
      <article
        key={comment.id}
        {...stylex.props(styles.commentArticle, inlineCommentArticleMarker)}
        data-inline-comment-article=""
      >
        {isRoot ? rootHeader : replyHeader}
        <div {...stylex.props(styles.commentIndent)}>
          {editingCommentId === comment.id ? (
            renderCommentBody(comment)
          ) : (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={openReplyComposer}
              {...stylex.props(styles.commentButton)}
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
      onMouseEnter={() => {
        onHoverChange(true);
      }}
      onMouseLeave={() => {
        onHoverChange(false);
      }}
      {...stylex.props(
        styles.card,
        active ? styles.active : styles.inactive,
        expanded && styles.expanded,
        inlineCommentCardMarker,
      )}
      data-inline-comment-card=""
      style={style}
    >
      {expanded && comments.length > 1 && (
        <span aria-hidden="true" {...stylex.props(styles.replyThreadLine)} />
      )}
      <div {...stylex.props(styles.cardContent)}>
        <div {...stylex.props(styles.rootComment)}>{renderComment(firstComment, true)}</div>
        <div {...stylex.props(styles.cardActions)}>
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
            {...stylex.props(styles.statusButton)}
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
          {...stylex.props(styles.showRepliesButton)}
        >
          {expanded
            ? 'Hide replies'
            : `${comments.length - 1} ${comments.length === 2 ? 'reply' : 'replies'}`}
        </button>
      )}
      {expanded && (
        <div {...stylex.props(styles.expandedContent)}>
          {comments.slice(1).map((comment) => renderComment(comment, false))}
          {canComment && (
            <form
              {...stylex.props(styles.replyForm)}
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
                className={
                  stylex.props(composerStyles.textarea, composerStyles.textareaCompact).className
                }
              />
              <div {...stylex.props(styles.replyFormActions)}>
                <button
                  type="button"
                  onClick={() => {
                    setReply('');
                    setExpanded(false);
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
          )}
        </div>
      )}
      {mutationError && (
        <p role="alert" {...stylex.props(styles.mutationError)}>
          {mutationError instanceof Error ? mutationError.message : 'Could not update comment'}
        </p>
      )}
    </article>
  );
}
