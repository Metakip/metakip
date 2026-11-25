import type { V1SearchSnippet, V1SearchTextMatch } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { BookOpen, FilePlus2, FileText, Folder, History, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { styles } from './CommandPaletteOptions.stylex';

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
      <mark key={index} {...stylex.props(styles.highlight)}>
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function optionClass(selected: boolean, result: boolean): string {
  return (
    stylex.props(
      styles.option,
      result ? styles.resultOption : styles.quickOption,
      selected && styles.selectedOption,
    ).className ?? ''
  );
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
    <div {...stylex.props(styles.options)}>
      {!query ? (
        <div id="command-palette-list" role="listbox" aria-label="Search suggestions">
          {recentSearches.length > 0 && (
            // biome-ignore lint/a11y/useSemanticElements: listbox groups are not form field groups
            <div role="group" aria-labelledby="recent-searches-heading">
              <div {...stylex.props(styles.sectionHeader)}>
                <div id="recent-searches-heading" {...stylex.props(styles.sectionTitle)}>
                  Recent searches
                </div>
                <button type="button" onClick={onClearRecent} {...stylex.props(styles.clearButton)}>
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
                  className={optionClass(selectedIndex === index, false)}
                >
                  <History aria-hidden="true" {...stylex.props(styles.recentIcon)} />
                  <span {...stylex.props(styles.recentText)}>{recentSearch}</span>
                </button>
              ))}
            </div>
          )}
          {/* biome-ignore lint/a11y/useSemanticElements: listbox groups are not form field groups */}
          <div role="group" aria-labelledby="quick-actions-heading">
            <div id="quick-actions-heading" {...stylex.props(styles.quickSectionTitle)}>
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
                  className={optionClass(selectedIndex === optionIndex, false)}
                >
                  <span {...stylex.props(styles.quickActionIcon)}>
                    <Icon aria-hidden="true" {...stylex.props(styles.smallIcon)} />
                  </span>
                  <span {...stylex.props(styles.optionText)}>
                    <span {...stylex.props(styles.actionTitle)}>{action.title}</span>
                    <span {...stylex.props(styles.actionDescription)}>{action.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : isLoading ? (
        <div role="status" {...stylex.props(styles.searching)}>
          Searching your workspace…
        </div>
      ) : results.length === 0 ? (
        <div {...stylex.props(styles.emptyResults)}>
          <p {...stylex.props(styles.emptyTitle)}>No results found</p>
          <p {...stylex.props(styles.emptyDescription)}>
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
              className={optionClass(selectedIndex === index, true)}
            >
              <span {...stylex.props(styles.quickActionIcon)}>
                {result.icon ? (
                  result.icon
                ) : result.type === 'folder' ? (
                  <Folder aria-hidden="true" {...stylex.props(styles.smallIcon)} />
                ) : (
                  <FileText aria-hidden="true" {...stylex.props(styles.smallIcon)} />
                )}
              </span>
              <span {...stylex.props(styles.optionText)}>
                <span {...stylex.props(styles.resultTitle)}>
                  {result.titleMatches ? (
                    <HighlightedText text={result.title} matches={result.titleMatches} />
                  ) : (
                    result.title
                  )}
                </span>
                {result.snippet && (
                  <span data-testid="search-result-snippet" {...stylex.props(styles.resultSnippet)}>
                    <HighlightedText {...result.snippet} />
                  </span>
                )}
                {result.breadcrumb.length > 0 && (
                  <span {...stylex.props(styles.breadcrumb)}>{result.breadcrumb.join(' / ')}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
