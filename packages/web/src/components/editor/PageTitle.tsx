import { MAX_PAGE_TITLE_LENGTH, truncateUnicodeCodePoints } from '@metakip/shared';
import type React from 'react';
import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import { useIsReadOnly } from '../../contexts/EditorReadOnlyContext';
import { usePageTitle } from '../../hooks/usePageTitle';

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
      className="w-full font-bold leading-tight text-zinc-900 dark:text-zinc-50 bg-transparent outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-700 focus:ring-0 focus:border-transparent transition-colors break-words font-serif"
      placeholder="Page Title"
      autoComplete="off"
      maxLength={MAX_PAGE_TITLE_LENGTH * 2}
      data-testid="page-title"
      style={{ fontSize: 'clamp(1.5rem, 3vw, 2.5rem)' }}
    />
  );
}
