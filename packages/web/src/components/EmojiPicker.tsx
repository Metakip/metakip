import { FloatingFocusManager, FloatingPortal } from '@floating-ui/react';
import * as stylex from '@stylexjs/stylex';
import clsx from 'clsx';
import {
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
  EmojiPicker as EmojiPickerPrimitive,
} from 'frimousse';
import { Search } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useId, useState } from 'react';
import { useFloatingMenu } from '../hooks/useFloatingMenu';
import { styles } from './EmojiPicker.stylex';

const MAX_EMOJI_COLUMNS = 9;
const DEFAULT_ROOT_FONT_SIZE = 16;
const DEFAULT_EMOJI_CELL_SIZE_REM = 2;
const DEFAULT_ROW_PADDING_REM = 0.5;
const EMOJI_PICKER_INITIALIZATION_TIMEOUT_MS = 5000;

function useEmojiPickerColumns(root: HTMLDivElement | null) {
  const [columns, setColumns] = useState(MAX_EMOJI_COLUMNS);

  useEffect(() => {
    if (!root) return;

    const updateColumns = () => {
      const styles = getComputedStyle(root);
      const documentRootFontSize =
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
        DEFAULT_ROOT_FONT_SIZE;
      const cellSizeRem =
        Number.parseFloat(styles.getPropertyValue('--emoji-picker-cell-size-rem')) ||
        DEFAULT_EMOJI_CELL_SIZE_REM;
      const rowPaddingRem =
        Number.parseFloat(styles.getPropertyValue('--emoji-picker-row-padding-rem')) ||
        DEFAULT_ROW_PADDING_REM;
      const cellSize = cellSizeRem * documentRootFontSize;
      const rowHorizontalPadding = rowPaddingRem * documentRootFontSize * 2;
      const availableWidth = root.clientWidth - rowHorizontalPadding;
      const nextColumns = Math.floor(availableWidth / cellSize);
      setColumns(Math.max(1, Math.min(MAX_EMOJI_COLUMNS, nextColumns)));
    };

    updateColumns();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateColumns);
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);

  return columns;
}

interface EmojiPickerProps {
  icon: string | null;
  onChange: (icon: string | null) => void;
  children: React.ReactNode;
}

function EmojiPickerRow({ children, className, ...props }: EmojiPickerListRowProps) {
  return (
    <div {...props} className={clsx(stylex.props(styles.row).className, className)}>
      {children}
    </div>
  );
}

function EmojiPickerEmoji({ emoji, className, ...props }: EmojiPickerListEmojiProps) {
  return (
    <button
      type="button"
      {...props}
      data-emoji-picker-button=""
      className={clsx(stylex.props(styles.emojiButton).className, className)}
    >
      {emoji.emoji}
    </button>
  );
}

function EmojiPickerCategoryHeader({
  category,
  className,
  ...props
}: EmojiPickerListCategoryHeaderProps) {
  return (
    <div {...props} className={clsx(stylex.props(styles.categoryHeader).className, className)}>
      {category.label}
    </div>
  );
}

function EmojiPickerLoading({
  hasTimedOut,
  onRetry,
  onTimeout,
}: {
  hasTimedOut: boolean;
  onRetry: () => void;
  onTimeout: () => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(onTimeout, EMOJI_PICKER_INITIALIZATION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [onTimeout]);

  if (!hasTimedOut) return <>Loading…</>;

  return (
    <>
      <span>Unable to initialize emoji picker.</span>
      <button type="button" {...stylex.props(styles.retryButton)} onClick={onRetry}>
        Retry
      </button>
    </>
  );
}

export function EmojiPicker({ icon, onChange, children }: EmojiPickerProps) {
  const [pickerRoot, setPickerRoot] = useState<HTMLDivElement | null>(null);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  const [loadingAttempt, setLoadingAttempt] = useState(0);
  const pickerId = useId();
  const columns = useEmojiPickerColumns(pickerRoot);
  const handlePickerOpen = useCallback(() => {
    setLoadingTimedOut(false);
  }, []);
  const handleLoadingTimeout = useCallback(() => {
    setLoadingTimedOut(true);
  }, []);
  const handleRetry = useCallback(() => {
    setLoadingTimedOut(false);
    setLoadingAttempt((attempt) => attempt + 1);
  }, []);
  const picker = useFloatingMenu({
    align: 'start',
    onOpen: handlePickerOpen,
    role: 'dialog',
    sideOffset: 4,
  });

  return (
    <>
      <button
        ref={picker.refs.setReference}
        aria-label={icon ? 'Change page icon' : 'Add page icon'}
        aria-haspopup="dialog"
        aria-expanded={picker.isOpen}
        aria-controls={picker.isOpen ? pickerId : undefined}
        type="button"
        {...stylex.props(styles.trigger)}
        {...picker.getReferenceProps()}
      >
        {children}
      </button>
      {picker.isMounted && (
        <FloatingPortal>
          <div
            id={pickerId}
            ref={picker.refs.setFloating}
            style={picker.floatingStyles}
            {...picker.getFloatingProps({ 'aria-label': 'Emoji picker' })}
            {...stylex.props(styles.portal)}
          >
            <FloatingFocusManager context={picker.context} modal={false} returnFocus>
              <div style={picker.transitionStyles} {...stylex.props(styles.popover)}>
                <EmojiPickerPrimitive.Root
                  key={loadingAttempt}
                  {...stylex.props(styles.pickerRoot)}
                  data-emoji-picker-root=""
                  columns={columns}
                  emojibaseUrl="/emojibase-data"
                  ref={setPickerRoot}
                  onEmojiSelect={({ emoji }) => {
                    onChange(emoji);
                    picker.close();
                  }}
                >
                  {/* Skin-tone and frequently-used controls are intentionally omitted for page icons. */}
                  <div {...stylex.props(styles.searchHeader)}>
                    <div {...stylex.props(styles.searchField)}>
                      <Search aria-hidden="true" {...stylex.props(styles.searchIcon)} />
                      <EmojiPickerPrimitive.Search
                        aria-label="Search emoji"
                        autoFocus
                        {...stylex.props(styles.searchInput)}
                        placeholder="Search"
                      />
                    </div>
                  </div>
                  <EmojiPickerPrimitive.Viewport
                    className={stylex.props(styles.viewport).className}
                  >
                    <EmojiPickerPrimitive.Loading
                      className={stylex.props(styles.statusState).className}
                    >
                      <EmojiPickerLoading
                        hasTimedOut={loadingTimedOut}
                        onRetry={handleRetry}
                        onTimeout={handleLoadingTimeout}
                      />
                    </EmojiPickerPrimitive.Loading>
                    <EmojiPickerPrimitive.Empty
                      className={stylex.props(styles.statusState).className}
                    >
                      No emoji found.
                    </EmojiPickerPrimitive.Empty>
                    <EmojiPickerPrimitive.List
                      className={stylex.props(styles.emojiList).className}
                      components={{
                        CategoryHeader: EmojiPickerCategoryHeader,
                        Emoji: EmojiPickerEmoji,
                        Row: EmojiPickerRow,
                      }}
                    />
                  </EmojiPickerPrimitive.Viewport>
                  <EmojiPickerPrimitive.ActiveEmoji>
                    {({ emoji }) => (
                      <div {...stylex.props(styles.activeEmoji)}>
                        {emoji ? (
                          <>
                            <span {...stylex.props(styles.activeEmojiCharacter)}>
                              {emoji.emoji}
                            </span>
                            <span {...stylex.props(styles.activeEmojiLabel)}>{emoji.label}</span>
                          </>
                        ) : (
                          <span>Select an emoji…</span>
                        )}
                      </div>
                    )}
                  </EmojiPickerPrimitive.ActiveEmoji>
                </EmojiPickerPrimitive.Root>
              </div>
            </FloatingFocusManager>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
