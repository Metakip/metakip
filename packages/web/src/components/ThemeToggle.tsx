import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { formatShortcut, SHORTCUT_PATTERNS } from '../utils/keyboardShortcuts';
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
        className="relative flex h-8 w-8 cursor-pointer items-center justify-center overflow-hidden rounded-md p-2 text-zinc-600 transition-colors hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <div className="relative w-full h-full flex items-center justify-center">
          <div
            className={`absolute transition-all duration-300 ${theme === 'light' ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 -rotate-90'}`}
          >
            <Sun size={16} />
          </div>
          <div
            className={`absolute transition-all duration-300 ${theme === 'dark' ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 rotate-90'}`}
          >
            <Moon size={16} />
          </div>
          <div
            className={`absolute transition-all duration-300 ${theme === 'system' ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-50 rotate-90'}`}
          >
            <Monitor size={16} />
          </div>
        </div>
      </button>
    </Tooltip>
  );
}
