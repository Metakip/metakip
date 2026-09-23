import type { EditorView } from '@codemirror/view';
import { useEffect } from 'react';
import { type ShortcutDefinition, useShortcuts } from '../../contexts/KeyboardShortcutContext';
import {
  isEditableFocused,
  keyboardRegistry,
  shouldIgnoreKeyboardEvent,
} from '../../hooks/useKeyboardShortcuts';
import type { EditorCommand, EditorCommandRegistry } from './editorCommandRegistry';
import { movePastInlineFormatting } from './inlineFormattingCommands';

export function useEditorShortcuts(
  editor: EditorView | null,
  _isReadOnly: boolean,
  commands: EditorCommandRegistry,
): void {
  const editorHasFocus = (): boolean => {
    return editor?.hasFocus ?? false;
  };
  const editorAction = (command: EditorCommand) => (): boolean => {
    if (editor?.state.readOnly || !editorHasFocus()) return false;
    if (command.requiresSelection) {
      const hasSelection = editor ? !editor.state.selection.main.empty : false;
      if (!hasSelection) return false;
    }
    command.execute();
    return true;
  };
  const shortcuts: ShortcutDefinition[] = commands.all.flatMap((command) =>
    command.available
      ? command.shortcutKeys.map((key, index) => ({
          key,
          handler: editorAction(command),
          scope: 'editor',
          ...(command.id === 'link' ? { priority: 'high' as const } : {}),
          description: index === 0 ? command.label : '',
        }))
      : [],
  );

  useShortcuts(shortcuts);

  // CodeMirror keymaps run on the editor before the document-level shortcut
  // listener. Capture editor shortcuts here so CodeMirror cannot consume a
  // formatting shortcut (Mod-I is also a built-in syntax-selection shortcut).
  useEffect(() => {
    if (!editor) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowRight' &&
        !event.isComposing &&
        editor.hasFocus &&
        !event.defaultPrevented &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        movePastInlineFormatting(editor)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!editor.hasFocus) return;
      if (
        !event.isComposing &&
        (event.ctrlKey || event.metaKey || event.altKey || event.key === 'Escape') &&
        keyboardRegistry.dispatch(event, isEditableFocused())
      ) {
        event.stopImmediatePropagation();
        return;
      }
      if (shouldIgnoreKeyboardEvent(event)) return;
    };
    editor.dom.addEventListener('keydown', handleKeyDown, true);
    return () => editor.dom.removeEventListener('keydown', handleKeyDown, true);
  }, [editor]);
}
