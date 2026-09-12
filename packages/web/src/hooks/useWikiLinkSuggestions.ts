import type { EditorView } from '@codemirror/view';
import { useCallback, useMemo, useRef, useState } from 'react';
import { getEditorSuggestionTrigger } from '../editor/codemirror/suggestionTriggers';
import { useCreatePage, usePages } from './use-pages';
import { useAuth } from './useAuth';

type WikiLinkPage = {
  id: string;
  title: string;
  icon: string | null;
};

interface SuggestionsState {
  isOpen: boolean;
  query: string;
  position: { x: number; y: number } | null;
  isLoading: boolean;
}

export function useWikiLinkSuggestions(
  editorRef: React.RefObject<EditorView | null>,
  sourcePageId: string,
) {
  const createPageMutation = useCreatePage();
  const { data: session } = useAuth();
  const { data: accessiblePages = [] } = usePages({ enabled: !!session?.user });
  const sourceOwnerId = accessiblePages.find((page) => page.id === sourcePageId)?.ownerId;
  const allPages = useMemo(() => {
    if (!sourceOwnerId) return [];
    return accessiblePages.filter((page) => page.ownerId === sourceOwnerId);
  }, [accessiblePages, sourceOwnerId]);
  const canAddPage = sourceOwnerId !== undefined && sourceOwnerId === session?.user?.id;

  const [suggestions, setSuggestions] = useState<SuggestionsState>({
    isOpen: false,
    query: '',
    position: null,
    isLoading: false,
  });

  const lockedPositionRef = useRef<{ x: number; y: number } | null>(null);

  const handleWikiLinkSuggest = useCallback(
    (
      isOpen: boolean,
      query: string,
      position: { x: number; y: number; top?: number; bottom?: number } | null,
    ) => {
      setSuggestions((prev) => {
        if (isOpen && !prev.isOpen && position) {
          lockedPositionRef.current = position;
        } else if (!isOpen) {
          lockedPositionRef.current = null;
        }

        return {
          ...prev,
          isOpen,
          query,
          position: lockedPositionRef.current,
        };
      });
    },
    [],
  );

  const handleWikiLinkSelect = useCallback(
    (page: WikiLinkPage) => {
      const editor = editorRef.current;
      if (!editor) return;
      try {
        const trigger = getEditorSuggestionTrigger(editor.state);
        if (trigger?.kind === 'wiki-link') {
          const insert = `[[id:${page.id}]]`;
          editor.dispatch({
            changes: { from: trigger.from, to: trigger.to, insert },
            selection: { anchor: trigger.from + insert.length },
            scrollIntoView: true,
          });
          editor.focus();
        }
      } catch {
        // Editor may have been destroyed
      }

      setSuggestions((prev) => ({ ...prev, isOpen: false }));
    },
    [editorRef],
  );

  const handleAddPage = useCallback(
    async (title: string) => {
      createPageMutation.mutate(
        { title: title || 'Untitled' },
        {
          onSuccess: (newPage) => {
            handleWikiLinkSelect({
              id: newPage.id,
              title: newPage.title,
              icon: newPage.icon,
            });
          },
        },
      );
    },
    [createPageMutation, handleWikiLinkSelect],
  );

  return {
    suggestions,
    allPages,
    handleWikiLinkSuggest,
    handleWikiLinkSelect,
    handleAddPage,
    canAddPage,
    closeSuggestions: () => setSuggestions((prev) => ({ ...prev, isOpen: false })),
  };
}
