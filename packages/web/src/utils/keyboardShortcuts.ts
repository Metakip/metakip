export interface ParsedShortcutPattern {
  modifiers: string[];
  key: string;
}

const MOD_K_SHORTCUT = 'mod+k';

export const SHORTCUT_PATTERNS = {
  toggleSidebar: 'mod+/',
  commandPalette: MOD_K_SHORTCUT,
  createNote: 'alt+n',
  createFolder: 'alt+shift+n',
  toggleTheme: 'mod+shift+d',
  paragraph: 'mod+alt+0',
  heading1: 'mod+alt+1',
  heading2: 'mod+alt+2',
  heading3: 'mod+alt+3',
  heading4: 'mod+alt+4',
  heading5: 'mod+alt+5',
  heading6: 'mod+alt+6',
  bold: 'mod+b',
  italic: 'mod+i',
  strikethrough: 'mod+shift+x',
  code: 'mod+shift+f',
  blockquote: 'mod+shift+b',
  link: MOD_K_SHORTCUT,
  bulletList: 'mod+alt+8',
  orderedList: 'mod+alt+7',
  taskList: 'mod+alt+9',
  image: 'mod+shift+i',
  tag: 'mod+shift+#',
} as const;

const MODIFIER_ALIASES: Record<string, string> = {
  cmd: 'mod',
  command: 'mod',
  control: 'mod',
  ctrl: 'mod',
  option: 'alt',
};

export function parseShortcutPattern(pattern: string): ParsedShortcutPattern {
  const parts = pattern.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const modifiers = parts.map((modifier) => MODIFIER_ALIASES[modifier] ?? modifier);
  modifiers.sort();
  return { modifiers, key };
}

export function normalizeShortcutPattern(pattern: string): string {
  const { modifiers, key } = parseShortcutPattern(pattern);
  const normalizedKey = /^[0-9]$/.test(key) ? `digit${key}` : key;
  return [...modifiers, normalizedKey].join('+');
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

export function formatShortcut(pattern: string): string {
  const { modifiers: parsedModifiers, key: parsedKey } = parseShortcutPattern(pattern);
  const mac = isMacPlatform();
  const labels: Record<string, string> = mac
    ? { mod: '⌘', alt: '⌥', shift: 'Shift' }
    : { mod: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  const modifierOrder = ['mod', 'alt', 'shift'];
  const modifiers = modifierOrder
    .filter((modifier) => parsedModifiers.includes(modifier))
    .map((modifier) => labels[modifier] ?? modifier);
  const key = /^digit[0-9]$/.test(parsedKey) ? parsedKey.slice(5) : parsedKey;
  const displayKey = key.length === 1 ? key.toUpperCase() : key;
  return [...modifiers, displayKey].join('+');
}

export function formatEditorShortcut(pattern: string): string {
  const { modifiers, key } = parseShortcutPattern(pattern);
  const modifierNames: Record<string, string> = {
    alt: 'Alt',
    mod: 'Mod',
    shift: 'Shift',
  };
  const modifierOrder = ['mod', 'alt', 'shift'];
  const orderedModifiers = [
    ...modifierOrder.filter((modifier) => modifiers.includes(modifier)),
    ...modifiers.filter((modifier) => !modifierOrder.includes(modifier)),
  ];
  return [...orderedModifiers.map((modifier) => modifierNames[modifier] ?? modifier), key].join(
    '-',
  );
}
