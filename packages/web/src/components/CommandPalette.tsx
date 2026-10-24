import { METAKIP_DOCS_URL } from '@metakip/shared';
import { Search, X } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { useShortcut, useShortcutScope } from '../contexts/KeyboardShortcutContext';
import { useAuth } from '../hooks/useAuth';
import { useEntityCreationActions } from '../hooks/useEntityCreationActions';
import { useRecentSearches } from '../hooks/useRecentSearches';
import { SHORTCUT_PATTERNS } from '../utils/keyboardShortcuts';
import { buildEntityPath, getWorkspacePath } from '../utils/url';
import { CommandPaletteOptions, QUICK_ACTIONS, type SearchResult } from './CommandPaletteOptions';

const API_BASE = '/api';

export function CommandPalette({ openSearch = false }: { openSearch?: boolean }) {
  const { data } = useAuth();
  const userId = data?.user.id;
  return userId ? (
    <AuthenticatedCommandPalette key={userId} userId={userId} openSearch={openSearch} />
  ) : null;
}

function AuthenticatedCommandPalette({
  userId,
  openSearch,
}: {
  userId: string;
  openSearch: boolean;
}) {
  const navigate = useIdentityNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const { recentSearches, rememberSearch, clearRecentSearches } = useRecentSearches(userId);
  const dialogRef = useRef<HTMLDivElement>(null);

  const entityCreation = useEntityCreationActions();

  const hasResults = results.length > 0;
  const trimmedQuery = query.trim();

  const { pushScope, popScope } = useShortcutScope();

  const closeDialog = useCallback(() => {
    rememberSearch(query);
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setIsLoading(false);
    setSelectedIndex(-1);
  }, [query, rememberSearch]);

  // Custom event for external triggers (e.g., from a button)
  useEffect(() => {
    const handleOpenSearch = () => setIsOpen(true);
    window.addEventListener('open-search', handleOpenSearch);
    return () => window.removeEventListener('open-search', handleOpenSearch);
  }, []);

  useEffect(() => {
    if (openSearch) setIsOpen(true);
  }, [openSearch]);

  // Toggle the command palette with the canonical Mod+K shortcut.
  useShortcut({
    key: SHORTCUT_PATTERNS.commandPalette,
    handler: () => {
      if (isOpen) closeDialog();
      else setIsOpen(true);
    },
    description: 'Open command palette',
  });

  // Scope management: when palette is open, suspend parent shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pushScope(['modal', 'universal']);
    inputRef.current?.focus();
    return () => {
      popScope();
      previouslyFocused?.focus();
    };
  }, [isOpen, pushScope, popScope]);

  // Escape closes the palette (only fires when 'modal' scope is active)
  useShortcut({
    key: 'escape',
    handler: closeDialog,
    scope: 'modal',
    description: 'Close command palette',
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!trimmedQuery) {
      setResults([]);
      setIsLoading(false);
      setSelectedIndex(-1);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(trimmedQuery)}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error('Failed to search');
        }
        const data = await res.json();
        const nextResults = Array.isArray(data?.results) ? (data.results as SearchResult[]) : [];
        setResults(nextResults);
        setSelectedIndex(-1);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setResults([]);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isOpen, trimmedQuery]);

  const entryCount = trimmedQuery ? results.length : recentSearches.length + QUICK_ACTIONS.length;
  const selectEntry = useCallback(
    (index: number) => {
      if (trimmedQuery) {
        const result = results[index];
        if (!result) return;
        navigate(buildEntityPath(result.type, result.title, result.id));
        closeDialog();
        return;
      }

      const recentSearch = recentSearches[index];
      if (recentSearch) {
        setQuery(recentSearch);
        setResults([]);
        setSelectedIndex(-1);
        setIsLoading(true);
        inputRef.current?.focus();
        return;
      }

      const action = QUICK_ACTIONS[index - recentSearches.length];
      if (!action) return;
      if (action.id === 'new-page') {
        void entityCreation
          .createPageAndNavigate()
          .then((page) => {
            if (page) closeDialog();
          })
          .catch(() => {
            // Error toast handled globally by MutationCache.onError
          });
      } else if (action.id === 'trash') {
        navigate(getWorkspacePath('trash'));
        closeDialog();
      } else {
        window.open(METAKIP_DOCS_URL, '_blank', 'noopener,noreferrer');
        closeDialog();
      }
    },
    [closeDialog, entityCreation, navigate, recentSearches, results, trimmedQuery],
  );

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && entryCount > 0) {
      event.preventDefault();
      setSelectedIndex((current) => (current < 0 ? 0 : (current + 1) % entryCount));
    } else if (event.key === 'ArrowUp' && entryCount > 0) {
      event.preventDefault();
      setSelectedIndex((current) =>
        current < 0 ? entryCount - 1 : (current - 1 + entryCount) % entryCount,
      );
    } else if (event.key === 'Enter' && selectedIndex >= 0) {
      event.preventDefault();
      selectEntry(selectedIndex);
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    } else if (event.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]):not([tabindex="-1"])',
      );
      const first = focusable?.[0];
      const last = focusable?.[focusable.length - 1];
      if (first && last && event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (first && last && !event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    event.stopPropagation();
  };

  const clearHistory = () => {
    clearRecentSearches();
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (selectedIndex < 0) return;
    document
      .getElementById(`command-palette-option-${selectedIndex}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) {
    return null;
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes the dialog
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/55 px-4 pt-[12vh] pb-4 backdrop-blur-sm animate-fade-in sm:pt-[16vh]"
      onClick={closeDialog}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl animate-slide-up dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="flex items-center gap-3 px-5">
          <Search
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-zinc-400 dark:text-zinc-500"
          />
          <input
            ref={inputRef}
            role="combobox"
            className="command-palette-search-input h-16 min-w-0 flex-1 border-0 bg-transparent text-lg text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            aria-label="Search pages and folders"
            aria-autocomplete="list"
            aria-expanded={!trimmedQuery || hasResults}
            aria-controls={!trimmedQuery || hasResults ? 'command-palette-list' : undefined}
            aria-activedescendant={
              selectedIndex >= 0 ? `command-palette-option-${selectedIndex}` : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setSelectedIndex(-1);
              setIsLoading(Boolean(event.target.value.trim()));
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search pages and folders..."
          />
          {isLoading && (
            <div
              aria-hidden="true"
              className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700 dark:border-zinc-600 dark:border-t-zinc-300"
            />
          )}
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                setResults([]);
                setSelectedIndex(-1);
                setIsLoading(false);
                inputRef.current?.focus();
              }}
              className="cursor-pointer rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <CommandPaletteOptions
          query={trimmedQuery}
          results={results}
          recentSearches={recentSearches}
          isLoading={isLoading}
          selectedIndex={selectedIndex}
          onSelect={selectEntry}
          onHover={setSelectedIndex}
          onClearRecent={clearHistory}
        />

        <div className="flex items-center gap-4 px-5 py-3 text-xs text-zinc-400 dark:text-zinc-500">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-zinc-200 px-1.5 py-0.5 font-sans dark:border-zinc-700">
              ↑↓
            </kbd>
            Navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-zinc-200 px-1.5 py-0.5 font-sans dark:border-zinc-700">
              ↵
            </kbd>
            Open
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-zinc-200 px-1.5 py-0.5 font-sans dark:border-zinc-700">
              Esc
            </kbd>
            Close
          </span>
        </div>
      </div>
    </div>
  );
}
