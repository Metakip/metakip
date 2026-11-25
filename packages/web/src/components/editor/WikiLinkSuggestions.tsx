import * as stylex from '@stylexjs/stylex';
import Fuse from 'fuse.js';
import { FileText, Plus } from 'lucide-react';
import type React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { styles } from './SuggestionMenu.stylex';

type WikiLinkPage = {
  id: string;
  title: string;
  icon: string | null;
};

interface WikiLinkSuggestionsProps {
  isOpen: boolean;
  query: string;
  pages: WikiLinkPage[];
  position: { x: number; y: number; top?: number; bottom?: number } | null;
  onSelect: (page: WikiLinkPage) => void;
  onClose: () => void;
  onAddPage?: (title: string) => void;
}

const MAX_RESULTS = 10;
const MENU_WIDTH = 320;
const MENU_OVERFLOW_THRESHOLD = 320;

export function WikiLinkSuggestions({
  isOpen,
  query,
  pages,
  position,
  onSelect,
  onClose,
  onAddPage,
}: WikiLinkSuggestionsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({
    opacity: 0,
    pointerEvents: 'none',
  });
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');

  const trimmedQuery = query.trim();

  // Initialize Fuse.js for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(pages, {
      keys: ['title'],
      threshold: 0.4,
      distance: 100,
      ignoreLocation: true,
    });
  }, [pages]);

  const results = useMemo(() => {
    if (!trimmedQuery) {
      return pages.slice(0, MAX_RESULTS);
    }
    const searchResults = fuse.search(trimmedQuery);
    return searchResults.map((r) => r.item).slice(0, MAX_RESULTS);
  }, [fuse, trimmedQuery, pages]);

  const totalItems = results.length + (onAddPage ? 1 : 0);

  useEffect(() => {
    if (isOpen) {
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !position || !containerRef.current) {
      if (!isOpen) {
        setMenuStyle({ opacity: 0, pointerEvents: 'none' });
      }
      return;
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const x = position.x;
    let newPlacement: 'top' | 'bottom' = 'bottom';

    const bottomCoord = position.bottom ?? position.y;
    const topCoord = position.top ?? position.y - 20;

    if (bottomCoord + MENU_OVERFLOW_THRESHOLD > viewportHeight - 20) {
      newPlacement = 'top';
    }

    setPlacement(newPlacement);

    const style: React.CSSProperties = {
      position: 'fixed',
      left: Math.max(20, Math.min(x, viewportWidth - MENU_WIDTH - 20)),
      opacity: 1,
      pointerEvents: 'auto',
      zIndex: 100,
    };

    if (newPlacement === 'top') {
      style.bottom = viewportHeight - topCoord + 8;
    } else {
      style.top = bottomCoord + 4;
    }

    setMenuStyle(style);
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex((prev) => (totalItems === 0 ? 0 : (prev + 1) % totalItems));
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex((prev) => (totalItems === 0 ? 0 : (prev - 1 + totalItems) % totalItems));
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (selectedIndex < results.length) {
          const selected = results[selectedIndex];
          if (selected) onSelect(selected);
        } else if (selectedIndex === results.length && onAddPage) {
          onAddPage(trimmedQuery);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, onSelect, results, selectedIndex, totalItems, onAddPage, trimmedQuery]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      data-testid="wikilink-suggestions"
      {...stylex.props(styles.menu, placement === 'bottom' ? styles.opensDown : styles.opensUp)}
      style={menuStyle}
    >
      <div {...stylex.props(styles.header)}>Link to page</div>
      <div {...stylex.props(styles.list)}>
        {results.length === 0 && !trimmedQuery ? (
          <div {...stylex.props(styles.emptyState)}>Type to search...</div>
        ) : results.length === 0 && trimmedQuery ? (
          <div {...stylex.props(styles.emptyState)}>No matches</div>
        ) : (
          <>
            {results.map((page, index) => (
              <button
                key={page.id}
                type="button"
                onClick={() => onSelect(page)}
                {...stylex.props(
                  styles.option,
                  index === selectedIndex ? styles.optionSelected : styles.optionIdle,
                )}
              >
                <span {...stylex.props(styles.optionIcon)}>
                  {page.icon ? page.icon : <FileText {...stylex.props(styles.fileIcon)} />}
                </span>
                <span {...stylex.props(styles.optionText)}>{page.title}</span>
              </button>
            ))}

            {results.length > 0 && onAddPage && <div {...stylex.props(styles.divider)} />}
          </>
        )}

        {onAddPage && (
          <button
            type="button"
            onClick={() => onAddPage(trimmedQuery)}
            {...stylex.props(
              styles.option,
              selectedIndex === results.length ? styles.optionSelected : styles.optionIdle,
            )}
          >
            <span {...stylex.props(styles.optionIcon)}>
              <Plus {...stylex.props(styles.actionIcon)} />
            </span>
            <span {...stylex.props(styles.optionText)}>
              {trimmedQuery ? `New "${trimmedQuery}" page` : 'Add new page'}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
