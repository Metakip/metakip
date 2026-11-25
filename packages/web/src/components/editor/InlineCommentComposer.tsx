import { COMMENT_BODY_MAX_LENGTH } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { styles } from './CommentComposer.stylex';

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
      className={stylex.props(styles.composer).className}
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
        {...stylex.props(styles.form)}
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
          {...stylex.props(styles.textarea, styles.textareaLarge)}
        />
        <div {...stylex.props(styles.composerActions)}>
          {error ? (
            <p role="alert" {...stylex.props(styles.error)}>
              {error}
            </p>
          ) : (
            <span />
          )}
          <div {...stylex.props(styles.buttonGroup)}>
            <button type="button" onClick={onCancel} {...stylex.props(styles.cancelButton)}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!body.trim() || submitting}
              {...stylex.props(styles.submitButton)}
            >
              {submitting ? 'Sending…' : 'Comment'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
