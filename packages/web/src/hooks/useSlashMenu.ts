import type { EditorView } from '@codemirror/view';
import { type MutableRefObject, useCallback, useRef, useState } from 'react';
import type { EditorCommandRegistry } from '../components/editor/editorCommandRegistry';

interface SlashMenuState {
  isOpen: boolean;
  query: string;
  position: { x: number; y: number; top?: number; bottom?: number } | null;
  range: { from: number; to: number } | null;
}

interface UseSlashMenuOptions {
  commands: EditorCommandRegistry;
}

export function useSlashMenu(
  editorRef: MutableRefObject<EditorView | null>,
  { commands }: UseSlashMenuOptions,
) {
  const [slashMenuState, setSlashMenuState] = useState<SlashMenuState>({
    isOpen: false,
    query: '',
    position: null,
    range: null,
  });

  const rangeRef = useRef(slashMenuState.range);
  rangeRef.current = slashMenuState.range;

  const handleSlashMenuSuggest = useCallback(
    (
      isOpen: boolean,
      query: string,
      position: { x: number; y: number; top?: number; bottom?: number } | null,
      range: { from: number; to: number } | null,
    ) => {
      setSlashMenuState({ isOpen, query, position, range });
    },
    [],
  );

  const closeSlashMenu = useCallback(() => {
    setSlashMenuState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const removeSlashTrigger = () => {
    const range = rangeRef.current;
    const editor = editorRef.current;
    if (!editor || !range) return;
    editor.dispatch({
      changes: { from: range.from, to: range.to },
      selection: { anchor: range.from },
    });
  };

  const executeSlashAction = (action: () => void) => {
    removeSlashTrigger();
    closeSlashMenu();
    setTimeout(() => {
      action();
      const editor = editorRef.current;
      editor?.focus();
    }, 0);
  };

  const slashCommands = commands.all
    .filter((command) => command.available && command.showInSlashMenu)
    .map((command) => ({
      ...command,
      onSelect: () => executeSlashAction(command.execute),
    }));

  return {
    slashMenuState,
    handleSlashMenuSuggest,
    closeSlashMenu,
    slashCommands,
  };
}
