import { MAX_PAGE_TITLE_LENGTH, truncateUnicodeCodePoints } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import type React from 'react';
import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { useIsReadOnly } from '../../contexts/EditorReadOnlyContext';
import { usePageTitle } from '../../hooks/usePageTitle';
import { styles } from './PageTitle.stylex';

interface PageTitleProps {
  pageId: string;
  initialTitle: string;
  ydoc?: Y.Doc | null;
  usePublicEndpoint?: boolean;
}

export function PageTitle({
  pageId,
  initialTitle,
  ydoc,
  usePublicEndpoint = false,
}: PageTitleProps) {
  const { title, setTitle, commitTitle } = usePageTitle(pageId, initialTitle ?? 'Untitled', ydoc, {
    usePublicEndpoint,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const readOnly = useIsReadOnly();
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const handleBlurOrEnter = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>) => {
      if (readOnlyRef.current) return;
      if ('key' in e && e.key !== 'Enter') return;
      const liveValue = inputRef.current?.value ?? title;
      commitTitle(liveValue);
    },
    [commitTitle, title],
  );

  return (
    <input
      ref={inputRef}
      type="text"
      value={title}
      readOnly={readOnly}
      onChange={(e) =>
        !readOnly && setTitle(truncateUnicodeCodePoints(e.target.value, MAX_PAGE_TITLE_LENGTH))
      }
      onBlur={handleBlurOrEnter}
      onKeyDown={handleBlurOrEnter}
      {...stylex.props(styles.input)}
      placeholder="Page Title"
      autoComplete="off"
      maxLength={MAX_PAGE_TITLE_LENGTH * 2}
      data-testid="page-title"
      style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)' }}
    />
  );
}
