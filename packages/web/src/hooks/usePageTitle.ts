import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { useIdentityLifecycle } from '../contexts/IdentityLifecycleContext';
import { updatePageNavigationCache } from '../utils/navigationCache';

const API_BASE = '/api';

async function updatePageTitle(
  pageId: string,
  title: string,
  usePublicEndpoint: boolean,
  isIdentityActive: () => boolean,
): Promise<void> {
  const request = (path: string) => {
    return fetch(`${API_BASE}/pages/${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  };
  let res = await request(usePublicEndpoint ? `${pageId}/title` : pageId);
  // Anonymous session detection can settle just after the page renders. If a
  // user commits during that brief window, retry through the edit-link route
  // instead of silently losing the title.
  if (!usePublicEndpoint && res.status === 401) {
    // A request that began for identity A must never retry after identity B
    // has mounted, because the second fetch would otherwise use B's cookies.
    if (!isIdentityActive()) throw new Error('Identity retired during title update');
    res = await request(`${pageId}/title`);
  }
  if (!res.ok) throw new Error('Failed to update title');
}

function normalizeTitle(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled';
}

type UsePageTitleOptions = {
  usePublicEndpoint?: boolean;
};

export function usePageTitle(
  pageId?: string,
  initialTitle?: string,
  ydoc?: Y.Doc | null,
  options: UsePageTitleOptions = {},
) {
  const [title, setTitleState] = useState(initialTitle ?? 'Untitled');
  const queryClient = useQueryClient();
  const identityLifecycle = useIdentityLifecycle();
  const usePublicEndpoint = options.usePublicEndpoint ?? false;
  const currentPageIdRef = useRef(pageId);
  const lastSavedTitleRef = useRef('Untitled');
  const hasLocalEditsRef = useRef(false);
  const setTitle = useCallback((value: string) => {
    hasLocalEditsRef.current = true;
    setTitleState(value);
  }, []);
  // Listen for title changes from Yjs (sync from other clients or offline reconnect)
  useEffect(() => {
    if (!ydoc) return undefined;

    const titleText = ydoc.getText('title');
    const observer = () => {
      if (hasLocalEditsRef.current) return;
      const newTitle = titleText.toString() || 'Untitled';
      setTitleState(newTitle);
      lastSavedTitleRef.current = newTitle;
    };
    titleText.observe(observer);

    return () => {
      titleText.unobserve(observer);
    };
  }, [ydoc]);

  useEffect(() => {
    if (currentPageIdRef.current !== pageId) {
      currentPageIdRef.current = pageId;
      hasLocalEditsRef.current = false;
      const normalized = normalizeTitle(initialTitle ?? 'Untitled');
      setTitleState(normalized);
      lastSavedTitleRef.current = normalized;
      return;
    }
    if (typeof initialTitle === 'string' && !hasLocalEditsRef.current) {
      const normalized = normalizeTitle(initialTitle);
      setTitleState(normalized);
      lastSavedTitleRef.current = normalized;
    }
  }, [initialTitle, pageId]);

  const mutation = useMutation({
    mutationFn: ({
      pageId: mutationPageId,
      title: nextTitle,
      usePublicEndpoint: mutationUsesPublicEndpoint,
    }: {
      pageId: string;
      title: string;
      usePublicEndpoint: boolean;
    }) => {
      return updatePageTitle(
        mutationPageId,
        nextTitle,
        mutationUsesPublicEndpoint,
        identityLifecycle.isActive,
      );
    },
    onSuccess: (_data, { pageId: mutationPageId, title: nextTitle }) => {
      updatePageNavigationCache(queryClient, mutationPageId, { title: nextTitle });
      queryClient.setQueryData(['pages', 'detail', mutationPageId], (old: unknown) => {
        if (!old || typeof old !== 'object' || Array.isArray(old)) return old;
        return { ...old, title: nextTitle };
      });
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['pages', 'recent'] });
      queryClient.invalidateQueries({ queryKey: ['stars'] });
      queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
      queryClient.invalidateQueries({ queryKey: ['shares'] });
    },
  });

  const commitTitle = useCallback(
    (newTitle: string) => {
      const mutationPageId = pageId;
      if (!mutationPageId) return;
      const nextTitle = normalizeTitle(newTitle);
      const isCurrentPage = currentPageIdRef.current === mutationPageId;
      if (isCurrentPage && nextTitle === lastSavedTitleRef.current) {
        hasLocalEditsRef.current = false;
        return;
      }
      if (isCurrentPage) hasLocalEditsRef.current = false;

      // Write to Yjs doc for offline queue and real-time sync
      if (ydoc) {
        const titleText = ydoc.getText('title');
        titleText.delete(0, titleText.length);
        titleText.insert(0, nextTitle);
      }

      // Persist through either the authenticated page endpoint or the
      // public-access endpoint. The collaboration update provides immediate
      // feedback while the API write makes the title canonical.
      mutation.mutate(
        { pageId: mutationPageId, title: nextTitle, usePublicEndpoint },
        {
          onSuccess: () => {
            if (currentPageIdRef.current === mutationPageId) {
              lastSavedTitleRef.current = nextTitle;
            }
          },
        },
      );
    },
    [mutation, pageId, usePublicEndpoint, ydoc],
  );

  return { title, setTitle, commitTitle };
}
