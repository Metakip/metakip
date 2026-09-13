import { METAKIP_DOCS_URL } from '@metakip/shared';
import { BookOpen, FileText, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { useShortcut, useShortcutScope } from '../contexts/KeyboardShortcutContext';
import { useEntityCreationActions } from '../hooks/useEntityCreationActions';
import { SHORTCUT_PATTERNS } from '../utils/keyboardShortcuts';
import { buildPagePath, getWorkspacePath } from '../utils/url';

const API_BASE = '/api';

type SearchResult = {
  id: string;
  title: string;
  icon: string | null;
};

export function CommandPalette() {
  const navigate = useIdentityNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const entityCreation = useEntityCreationActions();

  const hasResults = results.length > 0;
  const trimmedQuery = useMemo(() => query.trim(), [query]);

  const { pushScope, popScope } = useShortcutScope();

  const closeDialog = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setIsLoading(false);
  }, []);

  // Custom event for external triggers (e.g., from a button)
  useEffect(() => {
    const handleOpenSearch = () => setIsOpen(true);
    window.addEventListener('open-search', handleOpenSearch);
    return () => window.removeEventListener('open-search', handleOpenSearch);
  }, []);

  // Toggle the command palette with the canonical Mod+K shortcut.
  useShortcut({
    key: SHORTCUT_PATTERNS.commandPalette,
    handler: () => setIsOpen((prev) => !prev),
    description: 'Open command palette',
  });

  // Scope management: when palette is open, suspend parent shortcuts
  useEffect(() => {
    if (!isOpen) return;
    pushScope(['modal', 'universal']);
    inputRef.current?.focus();
    return () => popScope();
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
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [isOpen, trimmedQuery]);

  if (!isOpen) {
    return null;
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close; inner div has role="dialog"
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-900/60 backdrop-blur-sm px-4 py-20 animate-fade-in"
      onClick={closeDialog}
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeDialog();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-lg rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl animate-slide-up overflow-hidden"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="relative border-b border-zinc-200 dark:border-zinc-800 p-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeDialog();
            }}
            placeholder="Search pages..."
            className="w-full rounded-xl bg-transparent px-4 py-3 text-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:focus:ring-zinc-400/20 transition-shadow"
          />
          {isLoading && (
            <div className="absolute right-6 top-1/2 -translate-y-1/2">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-700 dark:border-t-zinc-300" />
            </div>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!trimmedQuery && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Type to search pages...</p>
            </div>
          )}

          {trimmedQuery && !isLoading && !hasResults && (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                No results found
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                We couldn't find anything matching &quot;{trimmedQuery}&quot;
              </p>
            </div>
          )}

          {hasResults && (
            <ul className="space-y-1">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => {
                      navigate(buildPagePath(result.title, result.id));
                      closeDialog();
                    }}
                    className="w-full rounded-xl px-4 py-3 text-left transition-all duration-200 flex items-center gap-3 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-200"
                  >
                    <div className="flex items-center justify-center w-8 h-8 rounded-md bg-zinc-200/50 dark:bg-zinc-700/50 text-lg shrink-0">
                      {result.icon ? (
                        result.icon
                      ) : (
                        <FileText className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{result.title}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3">
            <div className="px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Quick actions
            </div>
            <ul className="space-y-1">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    void entityCreation
                      .createPageAndNavigate()
                      .then((page) => {
                        if (page) closeDialog();
                      })
                      .catch(() => {
                        // Error toast handled globally by MutationCache.onError
                      });
                  }}
                  className="w-full rounded-xl px-4 py-3 text-left transition-all duration-200 flex items-center gap-3 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-200"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-zinc-200/50 dark:bg-zinc-700/50 text-lg shrink-0">
                    <Plus className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">New Page</div>
                  </div>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => {
                    navigate(getWorkspacePath('trash'));
                    closeDialog();
                  }}
                  className="w-full rounded-xl px-4 py-3 text-left transition-all duration-200 flex items-center gap-3 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-200"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-zinc-200/50 dark:bg-zinc-700/50 text-lg shrink-0">
                    <Trash2 className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">Go to Trash</div>
                  </div>
                </button>
              </li>
              <li>
                <a
                  href={METAKIP_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeDialog}
                  className="w-full rounded-xl px-4 py-3 text-left transition-all duration-200 flex items-center gap-3 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 hover:text-zinc-900 dark:hover:text-zinc-200"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-zinc-200/50 dark:bg-zinc-700/50 text-lg shrink-0">
                    <BookOpen className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">Open Documentation</div>
                  </div>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
