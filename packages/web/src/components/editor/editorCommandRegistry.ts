import {
  IconBlockquote,
  IconBold,
  IconCode,
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
  IconPhoto,
  IconStrikethrough,
  IconTable,
} from '@tabler/icons-react';
import { createElement, type ReactNode } from 'react';
import { formatShortcut, SHORTCUT_PATTERNS } from '../../utils/keyboardShortcuts';
import type { EditorFormattingCommands } from './editorFormattingCommands';
import type { EditorTableCommands } from './editorTableCommands';

type EditorCommandActions = EditorFormattingCommands & EditorTableCommands;

export type EditorCommandId =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'code-block'
  | 'blockquote'
  | 'link'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'
  | 'table'
  | 'image'
  | 'divider'
  | 'tag'
  | 'add-row-before'
  | 'add-row-after'
  | 'add-column-before'
  | 'add-column-after'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table';

export type EditorCommand = {
  id: EditorCommandId;
  label: string;
  hint: string;
  keywords: string[];
  icon: ReactNode;
  shortcut?: string;
  shortcutKeys: string[];
  requiresSelection?: boolean;
  showInSlashMenu: boolean;
  available: boolean;
  execute(): void;
};

export type EditorCommandRegistry = {
  all: EditorCommand[];
  command(id: EditorCommandId): EditorCommand;
};

type CommandDefinition = Omit<EditorCommand, 'available' | 'execute' | 'showInSlashMenu'> & {
  showInSlashMenu?: boolean;
  run(actions: EditorCommandActions): void;
};

const headingShortcuts = {
  1: SHORTCUT_PATTERNS.heading1,
  2: SHORTCUT_PATTERNS.heading2,
  3: SHORTCUT_PATTERNS.heading3,
  4: SHORTCUT_PATTERNS.heading4,
  5: SHORTCUT_PATTERNS.heading5,
  6: SHORTCUT_PATTERNS.heading6,
} as const;

const definitions: CommandDefinition[] = [
  {
    id: 'paragraph',
    label: 'Paragraph',
    hint: 'P',
    shortcutKeys: [SHORTCUT_PATTERNS.paragraph],
    keywords: ['paragraph', 'text', 'p'],
    icon: createElement('span', { className: 'text-xs' }, '¶'),
    run: (actions) => actions.runBlockCommand('paragraph'),
  },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => {
    const icons = { 1: IconH1, 2: IconH2, 3: IconH3, 4: IconH4, 5: IconH5, 6: IconH6 };
    const handlers = {
      1: 'handleH1',
      2: 'handleH2',
      3: 'handleH3',
      4: 'handleH4',
      5: 'handleH5',
      6: 'handleH6',
    } as const;
    return {
      id: `h${level}` as EditorCommandId,
      label: `Heading ${level}`,
      hint: `H${level}`,
      shortcutKeys: [headingShortcuts[level]],
      keywords: ['heading', `h${level}`, ...(level === 1 ? ['title'] : [])],
      icon: createElement(icons[level], { size: 16 }),
      run: (actions: EditorCommandActions) => actions[handlers[level]](),
    };
  }),
  {
    id: 'bold',
    label: 'Bold',
    hint: 'Bold',
    shortcutKeys: [SHORTCUT_PATTERNS.bold],
    keywords: ['bold', 'strong'],
    icon: createElement(IconBold, { size: 16 }),
    run: (actions) => actions.handleBold(),
  },
  {
    id: 'italic',
    label: 'Italic',
    hint: 'Italic',
    shortcutKeys: [SHORTCUT_PATTERNS.italic],
    keywords: ['italic', 'emphasis'],
    icon: createElement(IconItalic, { size: 16 }),
    run: (actions) => actions.handleItalic(),
  },
  {
    id: 'strikethrough',
    label: 'Strikethrough',
    hint: 'Strike',
    shortcutKeys: [SHORTCUT_PATTERNS.strikethrough],
    keywords: ['strikethrough', 'strike'],
    icon: createElement(IconStrikethrough, { size: 16 }),
    run: (actions) => actions.handleStrike(),
  },
  {
    id: 'code-block',
    label: 'Code block',
    hint: 'Block',
    shortcutKeys: [],
    keywords: ['codeblock', 'fenced', 'block'],
    icon: createElement(IconCode, { size: 16 }),
    run: (actions) => actions.runBlockCommand('code_block'),
  },
  {
    id: 'code',
    label: 'Code',
    hint: 'Code',
    shortcutKeys: [SHORTCUT_PATTERNS.code],
    keywords: ['code', 'inline'],
    icon: createElement(IconCode, { size: 16 }),
    run: (actions) => actions.handleCode(),
  },
  {
    id: 'blockquote',
    label: 'Blockquote',
    hint: 'Quote',
    shortcutKeys: [SHORTCUT_PATTERNS.blockquote],
    keywords: ['quote', 'blockquote', 'citation'],
    icon: createElement(IconBlockquote, { size: 16 }),
    run: (actions) => actions.handleBlockquote(),
  },
  {
    id: 'link',
    label: 'Link',
    hint: 'Link',
    shortcutKeys: [SHORTCUT_PATTERNS.link],
    keywords: ['link', 'url'],
    requiresSelection: true,
    icon: createElement(IconLink, { size: 16 }),
    run: (actions) => actions.handleLink(),
  },
  {
    id: 'bullet-list',
    label: 'Bullet List',
    hint: 'Bullet',
    shortcutKeys: [SHORTCUT_PATTERNS.bulletList],
    keywords: ['bullet', 'list', 'unordered'],
    icon: createElement(IconList, { size: 16 }),
    run: (actions) => actions.handleBulletList(),
  },
  {
    id: 'ordered-list',
    label: 'Ordered List',
    hint: 'Ordered',
    shortcutKeys: [SHORTCUT_PATTERNS.orderedList],
    keywords: ['ordered', 'list', 'number', 'numbered'],
    icon: createElement(IconListNumbers, { size: 16 }),
    run: (actions) => actions.handleOrderedList(),
  },
  {
    id: 'task-list',
    label: 'Task List',
    hint: 'Check',
    shortcutKeys: [SHORTCUT_PATTERNS.taskList],
    keywords: ['task', 'check', 'list', 'todo', 'checkbox'],
    icon: createElement(IconListCheck, { size: 16 }),
    run: (actions) => actions.handleTaskList(),
  },
  {
    id: 'table',
    label: 'Table',
    hint: 'Table',
    shortcutKeys: [],
    keywords: ['table', 'grid'],
    icon: createElement(IconTable, { size: 16 }),
    run: (actions) => actions.handleInsertTable(),
  },
  {
    id: 'image',
    label: 'Image',
    hint: 'Img',
    shortcutKeys: [SHORTCUT_PATTERNS.image],
    keywords: ['image', 'photo', 'upload'],
    icon: createElement(IconPhoto, { size: 16 }),
    run: (actions) => actions.handleImageUploadFromSlash(),
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: 'Line',
    shortcutKeys: [],
    keywords: ['divider', 'hr', 'line', 'separator', 'horizontal rule'],
    icon: createElement('span', { className: 'text-lg' }, '—'),
    run: (actions) => actions.handleInsertDivider(),
  },
  {
    id: 'tag',
    label: 'Tag',
    hint: 'Tag',
    shortcutKeys: [SHORTCUT_PATTERNS.tag],
    keywords: ['tag', 'label', 'property', '#'],
    icon: createElement('span', { className: 'text-sm' }, '#'),
    run: (actions) => actions.handleInsertTag(),
  },
  {
    id: 'add-row-before',
    label: 'Add row before',
    hint: '',
    shortcutKeys: [],
    keywords: [],
    icon: null,
    showInSlashMenu: false,
    run: (actions) => actions.handleAddRowBefore(),
  },
  {
    id: 'add-row-after',
    label: 'Add row after',
    hint: '',
    shortcutKeys: [],
    keywords: [],
    icon: null,
    showInSlashMenu: false,
    run: (actions) => actions.handleAddRowAfter(),
  },
  {
    id: 'add-column-before',
    label: 'Add column before',
    hint: '',
    shortcutKeys: [],
    keywords: [],
    icon: null,
    showInSlashMenu: false,
    run: (actions) => actions.handleAddColBefore(),
  },
  {
    id: 'add-column-after',
    label: 'Add column after',
    hint: '',
    shortcutKeys: [],
    keywords: [],
    icon: null,
    showInSlashMenu: false,
    run: (actions) => actions.handleAddColAfter(),
  },
  {
    id: 'delete-row',
    label: 'Delete row',
    hint: '',
    shortcutKeys: [],
    keywords: [],
    icon: null,
    showInSlashMenu: false,
    run: (actions) => actions.handleDeleteRow(),
  },
  {
    id: 'delete-column',
    label: 'Delete column',
    hint: '',
    shortcutKeys: [],
    keywords: [],
    icon: null,
    showInSlashMenu: false,
    run: (actions) => actions.handleDeleteCol(),
  },
  {
    id: 'delete-table',
    label: 'Delete table',
    hint: '',
    shortcutKeys: [],
    keywords: [],
    icon: null,
    showInSlashMenu: false,
    run: (actions) => actions.handleDeleteTable(),
  },
];

export function createEditorCommandRegistry(
  actions: EditorCommandActions,
  canUploadImages: boolean,
): EditorCommandRegistry {
  const all = definitions.map((definition) => {
    const primaryShortcut = definition.shortcutKeys[0];
    return {
      ...definition,
      ...(primaryShortcut ? { shortcut: formatShortcut(primaryShortcut) } : {}),
      available: definition.id !== 'image' || canUploadImages,
      showInSlashMenu: definition.showInSlashMenu ?? true,
      execute: () => definition.run(actions),
    };
  });
  return {
    all,
    command: (id) => {
      const command = all.find((candidate) => candidate.id === id);
      if (!command) throw new Error(`Unknown editor command: ${id}`);
      return command;
    },
  };
}
