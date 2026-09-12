import { autoUpdate, flip, inline, offset, shift, useFloating } from '@floating-ui/react';
import {
  IconBlockquote,
  IconBold,
  IconCode,
  IconColumnInsertLeft,
  IconColumnInsertRight,
  IconColumnRemove,
  IconH1,
  IconH2,
  IconH3,
  IconH4,
  IconH5,
  IconH6,
  IconItalic,
  IconLink,
  IconList,
  IconListCheck,
  IconListNumbers,
  IconRowInsertBottom,
  IconRowInsertTop,
  IconRowRemove,
  IconStrikethrough,
  IconTable,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useMemo } from 'react';
import { formatShortcut, SHORTCUT_PATTERNS } from '../../utils/keyboardShortcuts';

export interface FloatingToolbarProps {
  onBold: () => void;
  onItalic: () => void;
  onStrike: () => void;
  onCode: () => void;
  onLink: () => void;
  onBlockquote: () => void;
  onInsertTable: () => void;
  onAddRowBefore: () => void;
  onAddRowAfter: () => void;
  onAddColBefore: () => void;
  onAddColAfter: () => void;
  onDeleteRow: () => void;
  onDeleteCol: () => void;
  onDeleteTable: () => void;
  onH1: () => void;
  onH2: () => void;
  onH3: () => void;
  onH4: () => void;
  onH5: () => void;
  onH6: () => void;
  onBulletList: () => void;
  onOrderedList: () => void;
  onTaskList: () => void;
  onInteractionStart: () => void;
  visible: boolean;
  position: Range | null;
  isBoldActive?: boolean;
  isItalicActive?: boolean;
  isStrikeActive?: boolean;
  isCodeActive?: boolean;
  isLinkActive?: boolean;
  isBlockquoteActive?: boolean;
  isH1Active?: boolean;
  isH2Active?: boolean;
  isH3Active?: boolean;
  isH4Active?: boolean;
  isH5Active?: boolean;
  isH6Active?: boolean;
  isBulletListActive?: boolean;
  isOrderedListActive?: boolean;
  isTaskListActive?: boolean;
  isInTableActive?: boolean;
}

export function FloatingToolbar({
  onBold,
  onItalic,
  onStrike,
  onCode,
  onLink,
  onBlockquote,
  onInsertTable,
  onAddRowBefore,
  onAddRowAfter,
  onAddColBefore,
  onAddColAfter,
  onDeleteRow,
  onDeleteCol,
  onDeleteTable,
  onH1,
  onH2,
  onH3,
  onH4,
  onH5,
  onH6,
  onBulletList,
  onOrderedList,
  onTaskList,
  onInteractionStart,
  visible,
  position,
  isBoldActive,
  isItalicActive,
  isStrikeActive,
  isCodeActive,
  isLinkActive,
  isBlockquoteActive,
  isH1Active,
  isH2Active,
  isH3Active,
  isH4Active,
  isH5Active,
  isH6Active,
  isBulletListActive,
  isOrderedListActive,
  isTaskListActive,
  isInTableActive,
}: FloatingToolbarProps) {
  const boldShortcut = formatShortcut(SHORTCUT_PATTERNS.bold);
  const italicShortcut = formatShortcut(SHORTCUT_PATTERNS.italic);
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

  return (
    <div
      ref={refs.setFloating}
      role="toolbar"
      aria-label="Editor formatting"
      onPointerDown={onInteractionStart}
      onMouseDown={(event) => event.preventDefault()}
      className={`floating-toolbar flex items-center gap-1 px-2 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl ${visible && isPositioned ? '' : 'invisible'}`}
      style={{ ...floatingStyles, zIndex: 1000 }}
    >
      <button
        type="button"
        onClick={onBold}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isBoldActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title={`Bold (${boldShortcut})`}
      >
        <IconBold size={16} />
      </button>
      <button
        type="button"
        onClick={onItalic}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isItalicActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title={`Italic (${italicShortcut})`}
      >
        <IconItalic size={16} />
      </button>
      <button
        type="button"
        onClick={onStrike}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isStrikeActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Strikethrough"
      >
        <IconStrikethrough size={16} />
      </button>
      <button
        type="button"
        onClick={onCode}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isCodeActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Code"
      >
        <IconCode size={16} />
      </button>
      <button
        type="button"
        onClick={onLink}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isLinkActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Add Link"
      >
        <IconLink size={16} />
      </button>
      <button
        type="button"
        onClick={onBlockquote}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isBlockquoteActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Blockquote"
      >
        <IconBlockquote size={16} />
      </button>
      <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-600 mx-1" />
      <button
        type="button"
        onClick={onH1}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer font-bold ${isH1Active ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Heading 1"
      >
        <IconH1 size={16} />
      </button>
      <button
        type="button"
        onClick={onH2}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer font-bold ${isH2Active ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Heading 2"
      >
        <IconH2 size={16} />
      </button>
      <button
        type="button"
        onClick={onH3}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer font-bold ${isH3Active ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Heading 3"
      >
        <IconH3 size={16} />
      </button>
      <button
        type="button"
        onClick={onH4}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer font-bold ${isH4Active ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Heading 4"
      >
        <IconH4 size={16} />
      </button>
      <button
        type="button"
        onClick={onH5}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer font-bold ${isH5Active ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Heading 5"
      >
        <IconH5 size={16} />
      </button>
      <button
        type="button"
        onClick={onH6}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer font-bold ${isH6Active ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Heading 6"
      >
        <IconH6 size={16} />
      </button>
      <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-600 mx-1" />
      <button
        type="button"
        onClick={onBulletList}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isBulletListActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Bullet List"
      >
        <IconList size={16} />
      </button>
      <button
        type="button"
        onClick={onOrderedList}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isOrderedListActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Ordered List"
      >
        <IconListNumbers size={16} />
      </button>
      <button
        type="button"
        onClick={onTaskList}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isTaskListActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Task List"
      >
        <IconListCheck size={16} />
      </button>
      <button
        type="button"
        onClick={onInsertTable}
        className={`floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer ${isInTableActive ? 'bg-zinc-100 dark:bg-zinc-600 text-zinc-900 dark:text-white' : ''}`}
        title="Insert Table"
      >
        <IconTable size={16} />
      </button>
      {isInTableActive && (
        <>
          <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-600 mx-1" />
          <button
            type="button"
            onClick={onAddRowBefore}
            className="floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
            title="Add Row Above"
          >
            <IconRowInsertTop size={16} />
          </button>
          <button
            type="button"
            onClick={onAddRowAfter}
            className="floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
            title="Add Row Below"
          >
            <IconRowInsertBottom size={16} />
          </button>
          <button
            type="button"
            onClick={onAddColBefore}
            className="floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
            title="Add Column Left"
          >
            <IconColumnInsertLeft size={16} />
          </button>
          <button
            type="button"
            onClick={onAddColAfter}
            className="floating-toolbar-btn p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
            title="Add Column Right"
          >
            <IconColumnInsertRight size={16} />
          </button>
          <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-600 mx-1" />
          <button
            type="button"
            onClick={onDeleteRow}
            className="floating-toolbar-btn p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 text-red-500 dark:text-red-400 transition-colors cursor-pointer"
            title="Delete Row"
          >
            <IconRowRemove size={16} />
          </button>
          <button
            type="button"
            onClick={onDeleteCol}
            className="floating-toolbar-btn p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 text-red-500 dark:text-red-400 transition-colors cursor-pointer"
            title="Delete Column"
          >
            <IconColumnRemove size={16} />
          </button>
          <button
            type="button"
            onClick={onDeleteTable}
            className="floating-toolbar-btn p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 text-red-500 dark:text-red-400 transition-colors cursor-pointer"
            title="Delete Table"
          >
            <IconTrash size={16} />
          </button>
        </>
      )}
    </div>
  );
}
