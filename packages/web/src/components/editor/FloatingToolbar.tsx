import { autoUpdate, flip, inline, offset, shift, useFloating } from '@floating-ui/react';
import * as stylex from '@stylexjs/stylex';
import { MessageSquare } from 'lucide-react';
import { Fragment, useEffect, useMemo } from 'react';
import type { EditorCommandId, EditorCommandRegistry } from './editorCommandRegistry';
import { styles } from './FloatingToolbar.stylex';
import type { EditorActiveStates } from './useEditorActiveStates';

type ToolbarCommand = {
  id: EditorCommandId;
  title?: string;
  showShortcut?: boolean;
  destructive?: boolean;
} & (
  | { pressed: keyof EditorActiveStates; context?: never }
  | { pressed?: never; context?: keyof EditorActiveStates }
);

type CommandGroup = readonly [ToolbarCommand, ...ToolbarCommand[]];

const formattingGroups: readonly CommandGroup[] = [
  [
    { id: 'bold', pressed: 'isBoldActive', showShortcut: true },
    { id: 'italic', pressed: 'isItalicActive', showShortcut: true },
    { id: 'strikethrough', pressed: 'isStrikeActive' },
    { id: 'code', pressed: 'isCodeActive' },
    { id: 'link', title: 'Add Link', context: 'isLinkActive' },
    { id: 'blockquote', pressed: 'isBlockquoteActive' },
  ],
  [
    { id: 'h1', pressed: 'isH1Active' },
    { id: 'h2', pressed: 'isH2Active' },
    { id: 'h3', pressed: 'isH3Active' },
    { id: 'h4', pressed: 'isH4Active' },
    { id: 'h5', pressed: 'isH5Active' },
    { id: 'h6', pressed: 'isH6Active' },
  ],
  [
    { id: 'bullet-list', pressed: 'isBulletListActive' },
    { id: 'ordered-list', pressed: 'isOrderedListActive' },
    { id: 'task-list', pressed: 'isTaskListActive' },
    { id: 'table', title: 'Insert Table', context: 'isInTableActive' },
  ],
];

const tableGroups: readonly CommandGroup[] = [
  [
    { id: 'add-row-before' },
    { id: 'add-row-after' },
    { id: 'add-column-before' },
    { id: 'add-column-after' },
  ],
  [
    { id: 'delete-row', destructive: true },
    { id: 'delete-column', destructive: true },
    { id: 'delete-table', destructive: true },
  ],
];

export interface FloatingToolbarProps {
  commands: EditorCommandRegistry;
  activeStates: EditorActiveStates;
  onInteractionStart: () => void;
  onAddComment?: () => void;
  canComment?: boolean;
  commentOnly?: boolean;
  visible: boolean;
  position: Range | null;
}

export function FloatingToolbar({
  commands,
  activeStates,
  onInteractionStart,
  onAddComment,
  canComment = false,
  commentOnly = false,
  visible,
  position,
}: FloatingToolbarProps) {
  const virtualReference = useMemo(() => {
    if (!position) return null;

    const contextElement =
      position.commonAncestorContainer instanceof Element
        ? position.commonAncestorContainer
        : position.commonAncestorContainer.parentElement;

    return {
      getBoundingClientRect: () => position.getBoundingClientRect(),
      getClientRects: () => position.getClientRects(),
      ...(contextElement ? { contextElement } : {}),
    };
  }, [position]);
  const { refs, floatingStyles, isPositioned } = useFloating({
    open: visible,
    placement: 'top',
    strategy: 'fixed',
    middleware: [inline(), offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    refs.setPositionReference(virtualReference);
  }, [refs, virtualReference]);

  const groups = activeStates.isInTableActive
    ? [...formattingGroups, ...tableGroups]
    : formattingGroups;

  return (
    <div
      ref={refs.setFloating}
      role="toolbar"
      aria-label="Editor formatting"
      onPointerDown={onInteractionStart}
      onMouseDown={(event) => event.preventDefault()}
      className={
        stylex.props(styles.toolbar, !(visible && isPositioned) && styles.invisible).className
      }
      style={{ ...floatingStyles, zIndex: 1000 }}
    >
      {!commentOnly &&
        groups.map((group, index) => (
          <Fragment key={group[0].id}>
            {index > 0 && <div {...stylex.props(styles.divider)} aria-hidden="true" />}
            {group.map(({ id, title, showShortcut, destructive, pressed, context }) => {
              const { label, shortcut, icon, execute } = commands.command(id);
              const active =
                (pressed !== undefined && activeStates[pressed]) ||
                (context !== undefined && activeStates[context]);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={execute}
                  {...stylex.props(
                    styles.button,
                    destructive && styles.dangerButton,
                    active && styles.activeButton,
                  )}
                  aria-pressed={pressed === undefined ? undefined : activeStates[pressed]}
                  data-context-active={
                    context !== undefined && activeStates[context] ? '' : undefined
                  }
                  title={title ?? (showShortcut && shortcut ? `${label} (${shortcut})` : label)}
                >
                  {icon}
                </button>
              );
            })}
          </Fragment>
        ))}
      {canComment && onAddComment && (
        <>
          {!commentOnly && <div {...stylex.props(styles.divider)} aria-hidden="true" />}
          <button
            type="button"
            onClick={onAddComment}
            aria-label="Add comment to selection"
            title="Add Comment"
            {...stylex.props(styles.button)}
          >
            <MessageSquare size={16} />
          </button>
        </>
      )}
    </div>
  );
}
