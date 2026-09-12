import type { EditorView } from '@codemirror/view';
import { type ShortcutDefinition, useShortcuts } from '../../contexts/KeyboardShortcutContext';
import type { EditorCommand, EditorCommandRegistry } from './editorCommandRegistry';

export function useEditorShortcuts(
  editor: EditorView | null,
  isReadOnly: boolean,
  commands: EditorCommandRegistry,
): void {
  const editorHasFocus = (): boolean => {
    return editor?.hasFocus ?? false;
  };
  const editorAction = (command: EditorCommand) => (): boolean => {
    if (isReadOnly || !editorHasFocus()) return false;
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
}
