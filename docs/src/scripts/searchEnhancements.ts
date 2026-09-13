const SEARCH_HISTORY_KEY = 'metakip-docs-search-history';
const MAX_SEARCH_HISTORY = 5;

const SUGGESTED_SEARCHES = [
  'Create your first page',
  'Markdown support',
  'API authentication',
  'Self-hosting',
  'Use Metakip with AI assistants',
];

type SearchPanel = {
  element: HTMLElement;
  recentGroup: HTMLElement;
  recentList: HTMLElement;
  clearButton: HTMLButtonElement;
  suggestedList: HTMLElement;
};

let initialized = false;

function readStoredSearchHistory(): string | null | undefined {
  try {
    return window.localStorage.getItem(SEARCH_HISTORY_KEY);
  } catch {
    // Browser storage is optional and can be unavailable in private browsing modes.
    return undefined;
  }
}

function clearStoredSearchHistory(): void {
  try {
    window.localStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch {
    // Browser storage is optional and can be unavailable in private browsing modes.
  }
}

function reportMalformedSearchHistory(message: string): void {
  // biome-ignore lint/suspicious/noConsole: malformed browser state needs a visible diagnostic.
  console.warn(`[Metakip docs] ${message}`);
}

function readSearchHistory(): string[] {
  const rawValue = readStoredSearchHistory();
  if (rawValue === undefined || rawValue === null) return [];

  let stored: unknown;
  try {
    stored = JSON.parse(rawValue);
  } catch (error) {
    reportMalformedSearchHistory(
      `Ignoring malformed search history JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    clearStoredSearchHistory();
    return [];
  }

  if (
    !Array.isArray(stored) ||
    !stored.every((value): value is string => typeof value === 'string' && value.trim().length > 0)
  ) {
    reportMalformedSearchHistory('Ignoring search history with an invalid data shape.');
    clearStoredSearchHistory();
    return [];
  }

  return stored.map((value) => value.trim()).slice(0, MAX_SEARCH_HISTORY);
}

function writeSearchHistory(history: string[]): void {
  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Search still works when storage is unavailable, such as in private browsing modes.
  }
}

function addToSearchHistory(query: string): void {
  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  if (normalizedQuery.length === 0) return;

  const history = readSearchHistory().filter(
    (entry) => entry.toLowerCase() !== normalizedQuery.toLowerCase(),
  );
  writeSearchHistory([normalizedQuery, ...history].slice(0, MAX_SEARCH_HISTORY));
}

function createSearchButton(query: string, icon: 'clock' | 'arrow'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'metakip-search-item';
  button.dataset.searchQuery = query;

  const iconElement = document.createElement('span');
  iconElement.className = 'metakip-search-item-icon';
  iconElement.dataset.icon = icon;
  iconElement.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'metakip-search-item-label';
  label.textContent = query;

  button.append(iconElement, label);
  return button;
}

function createSearchGroup(title: string): {
  group: HTMLElement;
  list: HTMLElement;
} {
  const group = document.createElement('section');
  group.className = 'metakip-search-group';

  const heading = document.createElement('h2');
  heading.className = 'metakip-search-group-heading';
  heading.textContent = title;

  const list = document.createElement('div');
  list.className = 'metakip-search-item-list';

  group.append(heading, list);
  return { group, list };
}

function renderRecentSearches(panel: SearchPanel): void {
  const history = readSearchHistory();
  panel.recentList.replaceChildren(...history.map((query) => createSearchButton(query, 'clock')));
  panel.recentGroup.hidden = history.length === 0;
  panel.clearButton.hidden = history.length === 0;

  const recentQueries = new Set(history.map((query) => query.toLowerCase()));
  const suggestions = SUGGESTED_SEARCHES.filter((query) => !recentQueries.has(query.toLowerCase()));
  panel.suggestedList.replaceChildren(
    ...suggestions.map((query) => createSearchButton(query, 'arrow')),
  );
  const suggestedGroup = panel.suggestedList.closest<HTMLElement>('.metakip-search-group');
  if (suggestedGroup) suggestedGroup.hidden = suggestions.length === 0;
}

function createSearchPanel(): SearchPanel {
  const element = document.createElement('div');
  element.className = 'metakip-search-start';
  element.dataset.metakipSearchStart = '';

  const recent = createSearchGroup('Recent searches');
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'metakip-search-clear';
  clearButton.textContent = 'Clear';
  clearButton.dataset.clearSearchHistory = '';

  const recentHeading = recent.group.querySelector('h2');
  if (recentHeading) {
    const recentHeader = document.createElement('div');
    recentHeader.className = 'metakip-search-group-header';
    recentHeading.replaceWith(recentHeader);
    recentHeader.append(recentHeading, clearButton);
  }

  const suggested = createSearchGroup('Suggested');
  suggested.list.classList.add('metakip-search-suggestion-list');

  element.append(recent.group, suggested.group);

  const panel = {
    element,
    recentGroup: recent.group,
    recentList: recent.list,
    clearButton,
    suggestedList: suggested.list,
  };
  renderRecentSearches(panel);
  return panel;
}

function getSearchInput(siteSearch: HTMLElement): HTMLInputElement | null {
  const input = siteSearch.querySelector('input');
  return input instanceof HTMLInputElement ? input : null;
}

function getVisibleFocusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  const focusableSelector =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    if (element.closest('[hidden]')) return false;
    const styles = window.getComputedStyle(element);
    return (
      styles.display !== 'none' &&
      styles.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    );
  });
}

function trapDialogFocus(dialog: HTMLDialogElement): void {
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;

    const focusableElements = getVisibleFocusableElements(dialog);
    if (focusableElements.length === 0) return;

    const activeElement = document.activeElement;
    const currentIndex =
      activeElement instanceof HTMLElement ? focusableElements.indexOf(activeElement) : -1;
    const nextElement = event.shiftKey
      ? focusableElements[currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1]
      : focusableElements[currentIndex === focusableElements.length - 1 ? 0 : currentIndex + 1];

    if (!nextElement) return;
    event.preventDefault();
    nextElement.focus();
  });
}

function searchForQuery(siteSearch: HTMLElement, query: string): void {
  const input = getSearchInput(siteSearch);
  if (!input || query.length === 0) return;

  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

function bindSearchInput(siteSearch: HTMLElement, panel: SearchPanel): void {
  const input = getSearchInput(siteSearch);
  if (!input || input.dataset.metakipSearchHistoryBound === 'true') return;

  input.dataset.metakipSearchHistoryBound = 'true';
  const updatePanelVisibility = () => {
    panel.element.hidden = input.value.trim().length > 0;
  };

  input.addEventListener('input', updatePanelVisibility);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      addToSearchHistory(input.value);
      renderRecentSearches(panel);
    }
  });
  input.form?.addEventListener('submit', () => {
    addToSearchHistory(input.value);
    renderRecentSearches(panel);
  });
  updatePanelVisibility();
}

function enhanceSearch(): void {
  const siteSearch = document.querySelector('site-search');
  if (!(siteSearch instanceof HTMLElement)) return;

  const searchContainer = siteSearch.querySelector('.search-container');
  if (!(searchContainer instanceof HTMLElement)) return;

  let panel = searchContainer.querySelector<HTMLElement>('[data-metakip-search-start]');
  if (!panel) {
    const createdPanel = createSearchPanel();
    searchContainer.append(createdPanel.element);
    panel = createdPanel.element;
  }

  const recentGroup = panel.querySelector<HTMLElement>('.metakip-search-group');
  const recentList = panel.querySelector<HTMLElement>('.metakip-search-item-list');
  const clearButton = panel.querySelector<HTMLButtonElement>('[data-clear-search-history]');
  if (!recentGroup || !recentList || !clearButton) return;

  const suggestedList = panel.querySelector<HTMLElement>('.metakip-search-suggestion-list');
  if (!suggestedList) return;

  const searchPanel: SearchPanel = {
    element: panel,
    recentGroup,
    recentList,
    clearButton,
    suggestedList,
  };

  if (siteSearch.dataset.metakipSearchEnhancements !== 'true') {
    siteSearch.dataset.metakipSearchEnhancements = 'true';

    const dialog = siteSearch.querySelector('dialog');
    if (dialog instanceof HTMLDialogElement) trapDialogFocus(dialog);

    siteSearch.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const resultLink = target.closest('a.pagefind-ui__result-link');
        if (resultLink) {
          const input = getSearchInput(siteSearch);
          if (input) {
            addToSearchHistory(input.value);
            renderRecentSearches(searchPanel);
          }
        }
      },
      true,
    );

    panel.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (target.closest('[data-clear-search-history]')) {
        writeSearchHistory([]);
        renderRecentSearches(searchPanel);
        return;
      }

      const queryButton = target.closest<HTMLButtonElement>('[data-search-query]');
      if (queryButton?.dataset.searchQuery) {
        searchForQuery(siteSearch, queryButton.dataset.searchQuery);
      }
    });

    siteSearch.querySelector('dialog')?.addEventListener('close', () => {
      const input = getSearchInput(siteSearch);
      if (input) {
        addToSearchHistory(input.value);
        renderRecentSearches(searchPanel);
      }
    });
  }

  bindSearchInput(siteSearch, searchPanel);
}

export function initializeSearchEnhancements(): void {
  if (initialized) return;
  initialized = true;

  const run = () => enhanceSearch();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }

  const observer = new MutationObserver(run);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('astro:page-load', run);
}
