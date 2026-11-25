import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as stylex from '@stylexjs/stylex';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  GripVertical,
  Link,
  Mail,
  Plus,
  Tag as TagIcon,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type React from 'react';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsReadOnly } from '../../contexts/EditorReadOnlyContext';
import { useUpdatePage } from '../../hooks/use-pages';
import { usePropertyMetadata } from '../../hooks/usePropertyMetadata';
import { cleanTagName, tagIdentity } from '../../utils/tags';
import { showErrorToast } from '../../utils/toast';
import { addPropertyButtonMarker, propertyRowMarker, styles } from './PropertiesPanel.stylex';

interface PropertiesPanelProps {
  pageId: string;
  properties: Record<string, unknown> | null;
}

interface PropertyItem {
  id: string; // Truly stable internal ID
  key: string;
  value: unknown;
}

// --- Helpers ---

const getIconForKey = (key: string) => {
  const knownIcons: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    date: Calendar,
    created: Calendar,
    updated: Calendar,
    author: User,
    user: User,
    owner: User,
    url: Link,
    link: Link,
    website: Link,
    email: Mail,
    time: Clock,
    duration: Clock,
    tags: TagIcon,
    tag: TagIcon,
  };
  return knownIcons[key.toLowerCase()] ?? null;
};

const isUrl = (val: string) => val.startsWith('http://') || val.startsWith('https://');

const isTagPropertyKey = (key: string) => {
  const normalizedKey = key.toLowerCase();
  return normalizedKey === 'tags' || normalizedKey === 'tag';
};

const normalizeTagPropertyValue = (value: unknown): string[] | null => {
  if (Array.isArray(value)) {
    const stringValues = value.filter(
      (candidate): candidate is string => typeof candidate === 'string',
    );
    if (stringValues.length !== value.length) {
      return null;
    }
    return stringValues;
  }
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.trim().length > 0 ? [value] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  return null;
};

// --- Sub-components ---

interface TagValueEditorProps {
  tags: string[];
  onChange: (newTags: string[]) => void;
  suggestions: string[];
  onBlur?: () => void;
  onSuggestionsOpen?: () => void;
}

const TagValueEditor = forwardRef<HTMLInputElement, TagValueEditorProps>(
  ({ tags, onChange, suggestions, onBlur, onSuggestionsOpen }, ref) => {
    const readOnly = useIsReadOnly();
    const [inputValue, setInputValue] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);

    const filteredSuggestions = useMemo(() => {
      const existingTags = new Set(tags.map(tagIdentity));
      return suggestions.filter((suggestion) => {
        if (existingTags.has(tagIdentity(suggestion))) return false;
        return !inputValue || suggestion.toLowerCase().includes(inputValue.toLowerCase());
      });
    }, [inputValue, suggestions, tags]);

    const addTag = (tag: string) => {
      if (readOnly) return;
      const name = cleanTagName(tag);
      const identity = tagIdentity(name);
      if (identity && !tags.some((existing) => tagIdentity(existing) === identity)) {
        onChange([...tags, name]);
      }
      setInputValue('');
    };

    const removeTag = (tagToRemove: string) => {
      if (readOnly) return;
      onChange(tags.filter((t) => t !== tagToRemove));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (readOnly) return;
      if (e.key === 'ArrowDown') {
        if (filteredSuggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredSuggestions.length);
        }
      } else if (e.key === 'ArrowUp') {
        if (filteredSuggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex(
            (prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length,
          );
        }
      } else if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
        if (filteredSuggestions.length > 0 && (e.key === 'Enter' || e.key === 'Tab')) {
          e.preventDefault();
          const selected = filteredSuggestions[selectedIndex];
          if (selected) {
            addTag(selected);
          }
        } else {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(inputValue);
          }
        }
      } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
        const lastTag = tags[tags.length - 1];
        if (lastTag !== undefined) {
          removeTag(lastTag);
        }
      }
    };

    return (
      <div {...stylex.props(styles.tagList)}>
        {tags.map((tag) => (
          <span key={tag} {...stylex.props(styles.tagChip)}>
            {tag}
            {!readOnly && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                {...stylex.props(styles.removeTagButton)}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!readOnly && (
          <div {...stylex.props(styles.tagInputWrapper)}>
            <input
              ref={ref}
              type="text"
              data-testid="tag-input"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setIsFocused(true);
                onSuggestionsOpen?.();
              }}
              onBlur={() => {
                setIsFocused(false);
                if (onBlur) onBlur();
              }}
              placeholder={tags.length === 0 ? 'Empty' : 'Add tag...'}
              {...stylex.props(styles.inputReset, styles.tagInput)}
              style={{
                border: 'none',
                outline: 'none',
                boxShadow: 'none',
                background: 'transparent',
              }}
            />
            {isFocused && filteredSuggestions.length > 0 && (
              <div {...stylex.props(styles.suggestionList)}>
                {filteredSuggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(s);
                    }}
                    {...stylex.props(
                      styles.suggestionButton,
                      i === selectedIndex && styles.suggestionSelected,
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);
TagValueEditor.displayName = 'TagValueEditor';

interface PropertyKeySelectorProps {
  currentKey: string;
  onSelect: (newKey: string) => void;
  suggestions: string[];
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
}

function PropertyKeySelector({
  currentKey,
  onSelect,
  suggestions,
  isEditing,
  setIsEditing,
}: PropertyKeySelectorProps) {
  const readOnly = useIsReadOnly();
  const [inputValue, setInputValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasInteracted = useRef(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (readOnly && isEditing) {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
      hasInteracted.current = false;
      setIsEditing(false);
    }
  }, [isEditing, readOnly, setIsEditing]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const filtered = useMemo(() => {
    const query = inputValue.toLowerCase();
    if (!query || inputValue === currentKey) return suggestions;
    return suggestions.filter((s) => s.toLowerCase().includes(query));
  }, [inputValue, suggestions, currentKey]);

  const showCreateOption =
    inputValue.trim().length > 0 && inputValue !== currentKey && filtered.length === 0;
  const totalItems = filtered.length + (showCreateOption ? 1 : 0);

  useEffect(() => {
    if (isEditing) {
      if (!hasInteracted.current) {
        setInputValue(currentKey === 'New Property' || currentKey === '' ? '' : currentKey);
      }
      const idx = suggestions.indexOf(currentKey);
      setSelectedIndex(idx >= 0 ? idx : 0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } else {
      hasInteracted.current = false;
    }
  }, [isEditing, currentKey, suggestions]);

  const handleSelect = (key: string) => {
    if (readOnly) return;
    onSelect(key);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    if (e.key === 'ArrowDown') {
      if (totalItems > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % totalItems);
      }
    } else if (e.key === 'ArrowUp') {
      if (totalItems > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
      }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (showCreateOption && selectedIndex === 0) {
        handleSelect(inputValue);
      } else if (filtered.length > 0) {
        const adjustedIndex = showCreateOption ? selectedIndex - 1 : selectedIndex;
        const selected = filtered[adjustedIndex];
        if (selected) handleSelect(selected);
      } else {
        handleSelect(inputValue || currentKey);
      }
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  if (readOnly || !isEditing) {
    const IconComponent = getIconForKey(currentKey);
    return (
      <button
        type="button"
        onClick={() => !readOnly && setIsEditing(true)}
        {...stylex.props(styles.propertyKey, readOnly ? styles.keyReadOnly : styles.keyEditable)}
        style={{ border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent' }}
      >
        {IconComponent && (
          <IconComponent size={15} className={stylex.props(styles.propertyIcon).className ?? ''} />
        )}
        <span {...stylex.props(styles.keyLabel)}>{currentKey || 'New Property'}</span>
      </button>
    );
  }

  return (
    <div {...stylex.props(styles.keySelector)}>
      <input
        ref={inputRef}
        type="text"
        data-testid="key-input"
        value={inputValue}
        onChange={(e) => {
          hasInteracted.current = true;
          setInputValue(e.target.value);
          setSelectedIndex(0);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (readOnly) return;
          blurTimeoutRef.current = setTimeout(() => {
            if (inputRef.current && !readOnly) {
              handleSelect(inputValue.trim() || currentKey);
            }
          }, 150);
        }}
        {...stylex.props(styles.inputReset, styles.keyInput)}
        style={{ border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent' }}
        placeholder="Property name..."
      />
      <div {...stylex.props(styles.suggestionList)}>
        {showCreateOption && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              handleSelect(inputValue);
            }}
            {...stylex.props(
              styles.suggestionButton,
              selectedIndex === 0 && styles.suggestionSelected,
            )}
          >
            <Plus size={13} className={stylex.props(styles.propertyIcon).className ?? ''} />
            <span>Create &ldquo;{inputValue}&rdquo;</span>
          </button>
        )}
        {filtered.map((s, i) => {
          const Svg = getIconForKey(s);
          const isCurrent = s === currentKey;
          const idx = showCreateOption ? i + 1 : i;
          return (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(s);
              }}
              {...stylex.props(
                styles.suggestionButton,
                idx === selectedIndex && styles.suggestionSelected,
              )}
            >
              {Svg && (
                <Svg size={13} className={stylex.props(styles.propertyIcon).className ?? ''} />
              )}
              <span {...stylex.props(styles.suggestionText)}>{s}</span>
              {isCurrent && (
                <Check size={13} className={stylex.props(styles.propertyIcon).className ?? ''} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface SortablePropertyRowProps {
  item: PropertyItem;
  onUpdate: (id: string, value: unknown) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newKey: string) => void;
  isNew?: boolean;
}

function SortablePropertyRow({
  item,
  onUpdate,
  onDelete,
  onRename,
  isNew,
  propertyKeySuggestions,
  tagSuggestions,
  refreshTags,
}: SortablePropertyRowProps & {
  propertyKeySuggestions: string[];
  tagSuggestions: string[];
  refreshTags: () => void;
}) {
  const readOnly = useIsReadOnly();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: readOnly,
  });

  const [isEditingValue, setIsEditingValue] = useState(false);
  const [tempValue, setTempValue] = useState(() => {
    if (Array.isArray(item.value)) return item.value.join(', ');
    return String(item.value ?? '');
  });

  const valueInputRef = useRef<HTMLInputElement>(null);
  const tagEditorRef = useRef<HTMLInputElement>(null);
  const [isEditingKey, setIsEditingKey] = useState(isNew ?? false);
  const valueSavePending = useRef(false);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  const handleValueSave = (nextValue?: unknown) => {
    if (readOnlyRef.current) {
      setIsEditingValue(false);
      setTempValue(Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? ''));
      return;
    }
    if (valueSavePending.current) return;
    setIsEditingValue(false);
    const finalValue = nextValue !== undefined ? nextValue : tempValue.trim();
    if (finalValue !== (Array.isArray(item.value) ? item.value.join(', ') : item.value)) {
      valueSavePending.current = true;
      onUpdate(item.id, finalValue);
    }
  };

  useEffect(() => {
    if (readOnly) {
      valueSavePending.current = false;
      setIsEditingValue(false);
      setIsEditingKey(false);
      setTempValue(Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? ''));
    }
  }, [item.value, readOnly]);

  useEffect(() => {
    if (isEditingValue) {
      valueSavePending.current = false;
      valueInputRef.current?.focus();
    }
  }, [isEditingValue]);

  const isTagsProperty = isTagPropertyKey(item.key);

  const handleKeySelect = useCallback(
    (newKey: string) => {
      if (readOnlyRef.current) return;
      onRename(item.id, newKey);
      // Auto-focus the value area after selecting a property key
      const isTag = isTagPropertyKey(newKey);
      if (isTag) {
        setTimeout(() => tagEditorRef.current?.focus(), 0);
      } else {
        setIsEditingValue(true);
      }
    },
    [item.id, onRename],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-property-key={item.key}
      {...stylex.props(styles.propertyRow, isDragging && styles.dragging, propertyRowMarker)}
      data-property-row=""
    >
      {!readOnly && (
        <div
          {...attributes}
          {...listeners}
          {...stylex.props(styles.dragHandle)}
          data-property-drag-handle=""
        >
          <GripVertical size={15} />
        </div>
      )}

      <PropertyKeySelector
        currentKey={item.key}
        onSelect={handleKeySelect}
        suggestions={propertyKeySuggestions}
        isEditing={isEditingKey}
        setIsEditing={setIsEditingKey}
      />

      <div {...stylex.props(styles.valueWrapper)}>
        {isTagsProperty ? (
          <TagValueEditor
            ref={tagEditorRef}
            tags={
              Array.isArray(item.value)
                ? item.value.filter((tag): tag is string => typeof tag === 'string')
                : []
            }
            suggestions={tagSuggestions}
            onChange={(newTags) => {
              if (!readOnlyRef.current) onUpdate(item.id, newTags);
            }}
            onSuggestionsOpen={refreshTags}
          />
        ) : isEditingValue ? (
          <input
            ref={valueInputRef}
            type="text"
            data-testid="value-input"
            {...stylex.props(styles.inputReset, styles.valueInput)}
            style={{
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              background: 'transparent',
            }}
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            onBlur={() => handleValueSave()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleValueSave();
              if (e.key === 'Escape') {
                setIsEditingValue(false);
                setTempValue(
                  Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? ''),
                );
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => !readOnly && setIsEditingValue(true)}
            {...stylex.props(
              styles.valueButton,
              readOnly ? styles.valueReadOnly : styles.valueEditable,
            )}
            style={{
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              background: 'transparent',
            }}
          >
            {isUrl(String(item.value)) ? (
              <a
                href={String(item.value)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                {...stylex.props(styles.urlValue)}
              >
                <span {...stylex.props(styles.urlText)}>{String(item.value)}</span>
                <ExternalLink size={11} {...stylex.props(styles.externalLinkIcon)} />
              </a>
            ) : (
              <span {...stylex.props(!item.value && styles.emptyValue)}>
                {String(item.value || 'Empty')}
              </span>
            )}
          </button>
        )}
      </div>

      {!readOnly && (
        <button
          type="button"
          data-testid="delete-property"
          onClick={() => onDelete(item.id)}
          {...stylex.props(styles.deleteButton)}
          data-property-delete-button=""
          title="Delete property"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

// --- Main Component ---

export function PropertiesPanel({ pageId, properties }: PropertiesPanelProps) {
  const readOnly = useIsReadOnly();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [items, setItems] = useState<PropertyItem[]>([]);
  const [newPropertyId, setNewPropertyId] = useState<string | null>(null);
  const updatePage = useUpdatePage();
  const panelReadOnlyRef = useRef(readOnly);
  panelReadOnlyRef.current = readOnly;

  // Sync internal items with props while preserving order
  useEffect(() => {
    if (!properties) {
      setItems([]);
      return;
    }

    const propEntries = Object.entries(properties);

    setItems((currentItems) => {
      const newItems: PropertyItem[] = [];
      const handledKeys = new Set<string>();

      // 1. Keep existing items that are still in properties, update their values
      for (const item of currentItems) {
        if (item.id.startsWith('new-')) {
          newItems.push(item);
          handledKeys.add(item.key);
          continue;
        }

        if (Object.hasOwn(properties, item.key)) {
          newItems.push({
            ...item,
            value: properties[item.key],
          });
          handledKeys.add(item.key);
        }
      }

      // 2. Add new properties from the backend that aren't in our list yet
      for (const [key, value] of propEntries) {
        if (!handledKeys.has(key)) {
          newItems.push({
            id: key, // Use key as ID for existing properties from backend
            key,
            value,
          });
        }
      }

      return newItems;
    });
  }, [properties]);

  useEffect(() => {
    if (!readOnly) return;
    setNewPropertyId(null);
    setItems(Object.entries(properties ?? {}).map(([key, value]) => ({ id: key, key, value })));
  }, [properties, readOnly]);

  const {
    allKeys: propertyKeySuggestions,
    allTags: tagSuggestions,
    refreshTags,
  } = usePropertyMetadata();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const persistChanges = useCallback(
    (newItems: PropertyItem[]) => {
      if (panelReadOnlyRef.current) return;
      const nextProperties: Record<string, unknown> = {};
      for (const item of newItems) {
        const key = item.key.trim();
        if (!key) continue;

        const existing = nextProperties[key];
        if (existing !== undefined) {
          if (Array.isArray(existing) && Array.isArray(item.value)) {
            nextProperties[key] = [...new Set([...existing, ...item.value])];
          } else {
            nextProperties[key] = item.value;
          }
        } else {
          nextProperties[key] = item.value;
        }
      }
      updatePage.mutate({ pageId, updates: { properties: nextProperties }, silent: true });
    },
    [pageId, updatePage],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (panelReadOnlyRef.current) return;
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((i) => i.id === active.id);
        const newIndex = prev.findIndex((i) => i.id === over.id);
        const next = arrayMove(prev, oldIndex, newIndex);
        persistChanges(next);
        return next;
      });
    }
  };

  const updateProperty = (id: string, value: unknown) => {
    if (panelReadOnlyRef.current) return;
    setItems((prev) => {
      const next = prev.map((it) => (it.id === id ? { ...it, value } : it));
      persistChanges(next);
      return next;
    });
  };

  const deleteProperty = (id: string) => {
    if (panelReadOnlyRef.current) return;
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== id);
      persistChanges(next);
      return next;
    });
  };

  const renameProperty = (id: string, newKey: string) => {
    if (panelReadOnlyRef.current) return;
    const currentItem = items.find((item) => item.id === id);
    const nextValue = isTagPropertyKey(newKey)
      ? normalizeTagPropertyValue(currentItem?.value)
      : currentItem?.value;
    if (isTagPropertyKey(newKey) && nextValue === null) {
      showErrorToast('Tags can only contain string values');
      return;
    }

    setItems((currentItems) => {
      if (!newKey || currentItems.some((it) => it.id !== id && it.key === newKey)) {
        return [...currentItems]; // Trigger re-render to revert invalid input
      }
      const next = currentItems.map((it) =>
        it.id === id
          ? {
              ...it,
              key: newKey,
              value: isTagPropertyKey(newKey) ? nextValue : it.value,
            }
          : it,
      );
      persistChanges(next);
      return next;
    });
    setNewPropertyId(null);
  };

  const addProperty = () => {
    if (panelReadOnlyRef.current) return;
    const newId = `new-${Math.random().toString(36).slice(2, 11)}`;
    setItems((prev) => [...prev, { id: newId, key: '', value: '' }]);
    setNewPropertyId(newId);
    setIsCollapsed(false);
  };

  if (items.length === 0 && !isCollapsed) {
    if (readOnly) {
      return (
        <div {...stylex.props(styles.emptyProperties)}>
          <span {...stylex.props(styles.emptyLabel)}>No properties</span>
        </div>
      );
    }
    return (
      <div {...stylex.props(styles.emptyProperties)}>
        <button
          type="button"
          data-testid="add-property"
          onClick={addProperty}
          {...stylex.props(
            styles.addPropertyCommon,
            styles.addFirstPropertyButton,
            addPropertyButtonMarker,
          )}
          data-add-first-property=""
        >
          <Plus size={15} {...stylex.props(styles.addPropertyIcon)} data-add-property-icon="" />
          Add a property
        </button>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.propertiesPanel)}>
      <div {...stylex.props(styles.propertiesHeader)}>
        <button
          type="button"
          data-testid="properties-heading"
          onClick={() => setIsCollapsed(!isCollapsed)}
          {...stylex.props(styles.propertiesHeading)}
        >
          <div {...stylex.props(styles.collapseIcon)}>
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </div>
          <span>Properties</span>
          <span data-testid="property-count" {...stylex.props(styles.propertyCount)}>
            {items.length}
          </span>
        </button>
      </div>

      {!isCollapsed && (
        <div {...stylex.props(styles.propertyList)}>
          <DndContext
            key={readOnly ? 'read-only' : 'editable'}
            sensors={readOnly ? [] : sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items} strategy={verticalListSortingStrategy}>
              {items.map((item) => (
                <SortablePropertyRow
                  key={item.id}
                  item={item}
                  isNew={newPropertyId === item.id}
                  onUpdate={updateProperty}
                  onDelete={deleteProperty}
                  onRename={renameProperty}
                  propertyKeySuggestions={propertyKeySuggestions}
                  tagSuggestions={tagSuggestions}
                  refreshTags={refreshTags}
                />
              ))}
            </SortableContext>
          </DndContext>

          {!readOnly && (
            <button
              type="button"
              data-testid="add-property"
              onClick={addProperty}
              {...stylex.props(
                styles.addPropertyCommon,
                styles.addPropertyButton,
                addPropertyButtonMarker,
              )}
              data-add-property-button=""
            >
              <Plus size={15} {...stylex.props(styles.addPropertyIcon)} data-add-property-icon="" />
              <span>Add a property</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
