import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatEditorShortcut,
  formatShortcut,
  SHORTCUT_PATTERNS,
} from '../../utils/keyboardShortcuts';
import { createEditorCommandRegistry } from './editorCommandRegistry';
import type { EditorFormattingCommands } from './editorFormattingCommands';
import type { EditorTableCommands } from './editorTableCommands';

function createActions(): EditorFormattingCommands & EditorTableCommands {
  return {
    handleBlockquote: vi.fn(),
    handleBold: vi.fn(),
    handleBulletList: vi.fn(),
    handleCode: vi.fn(),
    handleH1: vi.fn(),
    handleH2: vi.fn(),
    handleH3: vi.fn(),
    handleH4: vi.fn(),
    handleH5: vi.fn(),
    handleH6: vi.fn(),
    handleImageUploadFromSlash: vi.fn(),
    handleInsertDivider: vi.fn(),
    handleInsertTag: vi.fn(),
    handleItalic: vi.fn(),
    handleLink: vi.fn(),
    handleOrderedList: vi.fn(),
    handleStrike: vi.fn(),
    handleTaskList: vi.fn(),
    runBlockCommand: vi.fn(),
    handleInsertTable: vi.fn(),
    handleAddRowBefore: vi.fn(),
    handleAddRowAfter: vi.fn(),
    handleAddColBefore: vi.fn(),
    handleAddColAfter: vi.fn(),
    handleDeleteRow: vi.fn(),
    handleDeleteCol: vi.fn(),
    handleDeleteTable: vi.fn(),
  };
}

describe('editor command shortcuts', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
  });

  it('formats shortcuts for the current platform', () => {
    expect(formatShortcut('mod+alt+7')).toBe('Ctrl+Alt+7');
    expect(formatShortcut('mod+shift+f')).toBe('Ctrl+Shift+F');
    expect(formatShortcut('Ctrl+N')).toBe('Ctrl+N');
    expect(formatShortcut('Cmd+N')).toBe('Ctrl+N');
    expect(formatShortcut('Command+N')).toBe('Ctrl+N');
    expect(formatShortcut('Option+N')).toBe('Alt+N');

    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });

    expect(formatShortcut('mod+alt+7')).toBe('⌘+⌥+7');
    expect(formatShortcut('mod+shift+f')).toBe('⌘+Shift+F');
    expect(formatShortcut('Ctrl+N')).toBe('⌘+N');
    expect(formatShortcut('Cmd+N')).toBe('⌘+N');
    expect(formatShortcut('Command+N')).toBe('⌘+N');
    expect(formatShortcut('Option+N')).toBe('⌥+N');
  });

  it('formats the canonical editor blockquote shortcut', () => {
    expect(formatEditorShortcut(SHORTCUT_PATTERNS.blockquote)).toBe('Mod-Shift-b');
  });

  it('uses the new contiguous list and code shortcut families', () => {
    const registry = createEditorCommandRegistry(createActions(), false);

    expect(registry.command('ordered-list')).toMatchObject({
      shortcut: 'Ctrl+Alt+7',
      shortcutKeys: ['mod+alt+7'],
    });
    expect(registry.command('bullet-list')).toMatchObject({
      shortcut: 'Ctrl+Alt+8',
      shortcutKeys: ['mod+alt+8'],
    });
    expect(registry.command('task-list')).toMatchObject({
      shortcut: 'Ctrl+Alt+9',
      shortcutKeys: ['mod+alt+9'],
    });
    expect(registry.command('code')).toMatchObject({
      shortcut: 'Ctrl+Shift+F',
      shortcutKeys: ['mod+shift+f'],
    });
    expect(registry.command('blockquote')).toMatchObject({
      shortcut: 'Ctrl+Shift+B',
      shortcutKeys: ['mod+shift+b'],
    });
  });

  it('does not retain the discontinued editor shortcuts', () => {
    const registry = createEditorCommandRegistry(createActions(), false);
    const shortcutKeys = registry.all.flatMap((command) => command.shortcutKeys);

    expect(shortcutKeys).not.toContain('mod+shift+7');
    expect(shortcutKeys).not.toContain('mod+shift+8');
    expect(shortcutKeys).not.toContain('mod+shift+[');
    expect(shortcutKeys).not.toContain('mod+`');
  });

  it('provides an explicit slash command for a fenced code block', () => {
    const actions = createActions();
    const registry = createEditorCommandRegistry(actions, false);
    expect(registry.command('code-block').showInSlashMenu).toBe(true);
    registry.command('code-block').execute();
    expect(actions.runBlockCommand).toHaveBeenCalledWith('code_block');
    expect(actions.handleCode).not.toHaveBeenCalled();
  });
});
