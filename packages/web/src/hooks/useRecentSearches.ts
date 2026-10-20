import { useCallback, useEffect, useState } from 'react';

const RECENT_SEARCHES_KEY = 'metakip:recentSearches';
const MAX_RECENT_SEARCHES = 5;

function storageKey(userId: string): string {
  return `${RECENT_SEARCHES_KEY}:${userId}`;
}

function readRecentSearches(userId: string): string[] {
  try {
    const stored = localStorage.getItem(storageKey(userId));
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function useRecentSearches(userId: string) {
  const [recentSearches, setRecentSearches] = useState(() => readRecentSearches(userId));

  useEffect(() => {
    // The previous global key may contain another account's searches. Never import it.
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // Storage may be unavailable.
    }
  }, []);

  const rememberSearch = useCallback(
    (value: string) => {
      const search = value.trim();
      if (!search) return;
      const nextSearches = [
        search,
        ...recentSearches.filter((recent) => recent.toLowerCase() !== search.toLowerCase()),
      ].slice(0, MAX_RECENT_SEARCHES);
      setRecentSearches(nextSearches);
      try {
        localStorage.setItem(storageKey(userId), JSON.stringify(nextSearches));
      } catch {
        // Keep in-memory history usable if browser storage is unavailable.
      }
    },
    [recentSearches, userId],
  );

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(storageKey(userId));
    } catch {
      // The in-memory list is cleared even if browser storage is unavailable.
    }
  }, [userId]);

  return { recentSearches, rememberSearch, clearRecentSearches };
}
