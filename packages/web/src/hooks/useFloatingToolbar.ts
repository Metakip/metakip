import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToolbarState {
  visible: boolean;
  position: Range | null;
}

export interface FloatingToolbarApi {
  visible: boolean;
  position: Range | null;
  keepVisible: () => void;
  reposition: () => void;
}

export function useFloatingToolbar(): FloatingToolbarApi {
  const [toolbarState, setToolbarState] = useState<ToolbarState>({
    visible: false,
    position: null,
  });

  const keepVisibleRef = useRef(false);

  const keepVisible = useCallback(() => {
    keepVisibleRef.current = true;
    setToolbarState((prev) => ({ ...prev, visible: true }));
    setTimeout(() => {
      keepVisibleRef.current = false;
    }, 300);
  }, []);

  const reposition = useCallback(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      return;
    }
    const container = document.querySelector('.codemirror-editor');
    if (!container?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      return;
    }
    setToolbarState({
      visible: true,
      position: selection.getRangeAt(0).cloneRange(),
    });
  }, []);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleSelectionChange = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const hide = () => {
          if (!keepVisibleRef.current) setToolbarState({ visible: false, position: null });
        };
        const selection = window.getSelection();
        if (!selection?.rangeCount) {
          hide();
          return;
        }

        const range = selection.getRangeAt(0);
        const container = document.querySelector('.codemirror-editor');

        if (!container?.contains(range.commonAncestorContainer)) {
          hide();
          return;
        }

        const element =
          range.commonAncestorContainer instanceof Element
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;
        const table = element?.closest('.cm-md-table');
        if (selection.isCollapsed && !table) {
          hide();
          return;
        }
        const position = range.cloneRange();
        if (selection.isCollapsed && table) {
          // An empty cell's caret may be anchored beside its widget. Position
          // the controls on the cell/row without changing the actual selection.
          position.selectNodeContents(element?.closest('.cm-md-table-cell, .cm-line') ?? table);
        }
        setToolbarState({
          visible: true,
          position,
        });
      }, 100);
    };

    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      clearTimeout(timeoutId);
    };
  }, []);

  return { ...toolbarState, keepVisible, reposition };
}
