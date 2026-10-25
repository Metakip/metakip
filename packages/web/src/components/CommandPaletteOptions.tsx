import type { V1SearchSnippet, V1SearchTextMatch } from '@metakip/shared';
import { BookOpen, FilePlus2, FileText, Folder, History, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

export type SearchResult = {
  id: string;
  type: 'page' | 'folder';
  title: string;
  icon: string | null;
  breadcrumb: string[];
  titleMatches?: V1SearchTextMatch[];
  snippet?: V1SearchSnippet;
};

export const QUICK_ACTIONS = [
  { id: 'new-page', title: 'New Page', description: 'Create a blank page', icon: FilePlus2 },
  { id: 'trash', title: 'Go to Trash', description: 'Restore or remove pages', icon: Trash2 },
  {
    id: 'docs',
    title: 'Open Documentation',
    description: 'Browse guides and features',
    icon: BookOpen,
  },
] as const;

function HighlightedText({
  text,
  matches,
}: {
  text: string;
  matches: V1SearchTextMatch[];
}): ReactNode {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [index, match] of matches.entries()) {
    if (match.start > cursor) parts.push(text.slice(cursor, match.start));
    parts.push(
      <mark
        key={index}
        className="rounded bg-amber-200/80 px-0.5 text-zinc-900 dark:bg-amber-700/60 dark:text-zinc-100"
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function optionClass(selected: boolean, padding: string): string {
  return `flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 ${padding} text-left transition-colors ${
    selected
      ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
      : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
  }`;
}

type PaletteOptionsProps = {
  query: string;
  results: SearchResult[];
  recentSearches: string[];
  isLoading: boolean;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  onClearRecent: () => void;
};

export function CommandPaletteOptions({
  query,
  results,
  recentSearches,
  isLoading,
  selectedIndex,
  onSelect,
  onHover,
  onClearRecent,
}: PaletteOptionsProps) {
  return (
    <div className="max-h-[60vh] min-h-24 overflow-y-auto p-2 sm:p-3">
      {!query ? (
        <div id="command-palette-list" role="listbox" aria-label="Search suggestions">
          {recentSearches.length > 0 && (
            // biome-ignore lint/a11y/useSemanticElements: listbox groups are not form field groups
            <div role="group" aria-labelledby="recent-searches-heading">
              <div className="flex items-center justify-between px-3 pb-2 pt-1">
                <div
                  id="recent-searches-heading"
                  className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
                >
                  Recent searches
                </div>
                <button
                  type="button"
                  onClick={onClearRecent}
                  className="cursor-pointer rounded px-1.5 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  Clear
                </button>
              </div>
              {recentSearches.map((recentSearch, index) => (
                <button
                  key={recentSearch}
                  id={`command-palette-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selectedIndex === index}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onSelect(index)}
                  className={optionClass(selectedIndex === index, 'py-2.5')}
                >
                  <History aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate text-sm">{recentSearch}</span>
                </button>
              ))}
            </div>
          )}
          {/* biome-ignore lint/a11y/useSemanticElements: listbox groups are not form field groups */}
          <div role="group" aria-labelledby="quick-actions-heading">
            <div
              id="quick-actions-heading"
              className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
            >
              Quick actions
            </div>
            {QUICK_ACTIONS.map((action, index) => {
              const optionIndex = recentSearches.length + index;
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  id={`command-palette-option-${optionIndex}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selectedIndex === optionIndex}
                  onMouseEnter={() => onHover(optionIndex)}
                  onClick={() => onSelect(optionIndex)}
                  className={optionClass(selectedIndex === optionIndex, 'py-2.5')}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-200/60 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300">
                    <Icon aria-hidden="true" className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{action.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {action.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : isLoading ? (
        <div
          role="status"
          className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
        >
          Searching your workspace…
        </div>
      ) : results.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No results found</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            We couldn't find anything matching &quot;{query}&quot;
          </p>
        </div>
      ) : (
        <div id="command-palette-list" role="listbox" aria-label="Search results">
          {results.map((result, index) => (
            <button
              key={`${result.type}:${result.id}`}
              id={`command-palette-option-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={selectedIndex === index}
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(index)}
              className={optionClass(selectedIndex === index, 'py-3')}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-200/60 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300">
                {result.icon ? (
                  result.icon
                ) : result.type === 'folder' ? (
                  <Folder aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <FileText aria-hidden="true" className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {result.titleMatches ? (
                    <HighlightedText text={result.title} matches={result.titleMatches} />
                  ) : (
                    result.title
                  )}
                </span>
                {result.snippet && (
                  <span
                    data-testid="search-result-snippet"
                    className="mt-1 block line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400"
                  >
                    <HighlightedText {...result.snippet} />
                  </span>
                )}
                {result.breadcrumb.length > 0 && (
                  <span className="mt-1 block truncate text-xs text-zinc-400 dark:text-zinc-500">
                    {result.breadcrumb.join(' / ')}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
