import * as stylex from '@stylexjs/stylex';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { formatShortcut, SHORTCUT_PATTERNS } from '../utils/keyboardShortcuts';
import { styles } from './ThemeToggle.stylex';
import { Tooltip } from './Tooltip';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const shortcutLabel = formatShortcut(SHORTCUT_PATTERNS.toggleTheme);

  const toggleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const labels: Record<string, string> = {
    light: `Switch to dark theme (${shortcutLabel})`,
    dark: `Switch to system theme (${shortcutLabel})`,
    system: `Switch to light theme (${shortcutLabel})`,
  };

  return (
    <Tooltip label={labels[theme] || 'Change theme'} position="right">
      <button
        type="button"
        aria-label="Toggle theme"
        onClick={toggleTheme}
        {...stylex.props(styles.button)}
      >
        <div {...stylex.props(styles.iconStack)}>
          <div
            {...stylex.props(styles.icon, theme === 'light' ? styles.visible : styles.hiddenLeft)}
          >
            <Sun size={16} />
          </div>
          <div
            {...stylex.props(styles.icon, theme === 'dark' ? styles.visible : styles.hiddenRight)}
          >
            <Moon size={16} />
          </div>
          <div
            {...stylex.props(styles.icon, theme === 'system' ? styles.visible : styles.hiddenRight)}
          >
            <Monitor size={16} />
          </div>
        </div>
      </button>
    </Tooltip>
  );
}
