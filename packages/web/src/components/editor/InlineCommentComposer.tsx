import { COMMENT_BODY_MAX_LENGTH } from '@metakip/shared';
import { useEffect, useRef, useState } from 'react';
import {
  commentCancelButtonClass,
  commentSubmitButtonClass,
  commentTextareaFocusClass,
} from './commentComposerStyles';

type InlineCommentComposerProps = {
  position: { left: number; right: number; top: number; bottom: number };
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
};

export function InlineCommentComposer({
  position,
  onSubmit,
  onCancel,
}: InlineCommentComposerProps) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const left = Math.max(12, Math.min(position.right + 12, window.innerWidth - 340));
  const top = Math.max(12, Math.min(position.top, window.innerHeight - 160));

  return (
    <div
      role="dialog"
      aria-label="Add comment to selection"
      className="fixed z-40 w-[320px] rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      style={{ left, top }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!body.trim() || submitting) return;
          setSubmitting(true);
          setError(null);
          try {
            await onSubmit(body.trim());
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Could not add comment');
            setSubmitting(false);
          }
        }}
        className="space-y-2"
      >
        <textarea
          ref={inputRef}
          value={body}
          maxLength={COMMENT_BODY_MAX_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
            event.preventDefault();
            event.stopPropagation();
            if (body.trim() && !submitting) event.currentTarget.form?.requestSubmit();
          }}
          aria-label="New comment on selection"
          placeholder="Add a comment…"
          rows={2}
          className={`w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 ${commentTextareaFocusClass} dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100`}
        />
        <div className="flex items-center justify-between gap-3">
          {error ? (
            <p role="alert" className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-400">
              {error}
            </p>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onCancel} className={commentCancelButtonClass}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!body.trim() || submitting}
              className={commentSubmitButtonClass}
            >
              {submitting ? 'Sending…' : 'Comment'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
