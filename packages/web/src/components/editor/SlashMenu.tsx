import * as stylex from '@stylexjs/stylex';
import Fuse from 'fuse.js';
import type React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { styles } from './SuggestionMenu.stylex';

export interface SlashCommandItem {
  id: string;
  label: string;
  hint: string;
  shortcut?: string;
  keywords: string[];
  icon: React.ReactNode;
  onSelect: () => void;
}

interface SlashMenuProps {
  isOpen: boolean;
  query: string;
  position: { x: number; y: number; top?: number; bottom?: number } | null;
  commands: SlashCommandItem[];
  onClose: () => void;
}

const MENU_WIDTH = 320;
const MENU_OVERFLOW_THRESHOLD = 320;

export function SlashMenu({ isOpen, query, position, commands, onClose }: SlashMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const trimmedQuery = query.trim();

  const fuse = useMemo(() => {
    return new Fuse(commands, {
      keys: ['label', 'keywords'],
      threshold: 0.35,
      distance: 100,
      ignoreLocation: true,
    });
  }, [commands]);

  const results = useMemo(() => {
    if (!trimmedQuery) return commands;
    return fuse.search(trimmedQuery).map((result) => result.item);
  }, [commands, fuse, trimmedQuery]);

  useEffect(() => {
    if (isOpen) setSelectedIndex(0);
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, results.length - 1)));
  }, [results]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!isOpen || !position) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const bottomCoord = position.bottom ?? position.y;
    const topCoord = position.top ?? position.y - 20;
    const nextPlacement =
      bottomCoord + MENU_OVERFLOW_THRESHOLD > viewportHeight - 20 ? 'top' : 'bottom';

    setPlacement(nextPlacement);

    el.style.position = 'fixed';
    el.style.left = `${Math.max(20, Math.min(position.x, viewportWidth - MENU_WIDTH - 20))}px`;
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.style.zIndex = '100';

    if (nextPlacement === 'top') {
      el.style.top = 'auto';
      el.style.bottom = `${viewportHeight - topCoord + 8}px`;
    } else {
      el.style.top = `${bottomCoord + 4}px`;
      el.style.bottom = 'auto';
    }
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) return;

    const list = listRef.current;
    if (!list) return;

    const buttons = list.querySelectorAll<HTMLElement>(':scope > button');
    const selectedButton = buttons[selectedIndex];
    if (!selectedButton) return;

    const listRect = list.getBoundingClientRect();
    const buttonRect = selectedButton.getBoundingClientRect();

    if (buttonRect.bottom > listRect.bottom) {
      list.scrollTop += buttonRect.bottom - listRect.bottom;
    } else if (buttonRect.top < listRect.top) {
      list.scrollTop -= listRect.top - buttonRect.top;
    }
  }, [selectedIndex, isOpen]);

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
        setSelectedIndex((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIndex((prev) =>
          results.length === 0 ? 0 : (prev - 1 + results.length) % results.length,
        );
        return;
      }

      if (event.key === 'Enter') {
        const selected = results[selectedIndex];
        if (!selected) return;
        event.preventDefault();
        event.stopPropagation();
        selected.onSelect();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, results, selectedIndex]);

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

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      data-testid="slash-menu"
      {...stylex.props(styles.menu, placement === 'bottom' ? styles.opensDown : styles.opensUp)}
    >
      <div {...stylex.props(styles.header)}>Insert block</div>

      <div ref={listRef} {...stylex.props(styles.list)}>
        {results.length === 0 ? (
          <div {...stylex.props(styles.emptyState)}>No matching commands</div>
        ) : (
          results.map((command, index) => (
            <button
              key={command.id}
              type="button"
              onClick={command.onSelect}
              {...stylex.props(
                styles.option,
                index === selectedIndex ? styles.optionSelected : styles.optionIdle,
              )}
            >
              <span {...stylex.props(styles.optionIcon)}>{command.icon}</span>
              <span {...stylex.props(styles.optionText)}>{command.label}</span>
              {command.shortcut && (
                <span {...stylex.props(styles.optionShortcut)}>{command.shortcut}</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
