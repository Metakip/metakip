import { METAKIP_DOCS_URL, METAKIP_GITHUB_URL } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { BookOpen, Github, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { styles } from './HeaderActions.stylex';

export function HeaderActions() {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  return (
    <div {...stylex.props(styles.root)}>
      <button
        type="button"
        onClick={toggleTheme}
        {...stylex.props(styles.themeButton)}
        title={`Theme: ${theme}`}
      >
        <div {...stylex.props(styles.iconFrame)}>
          <div
            {...stylex.props(styles.icon, theme === 'light' ? styles.visible : styles.sunHidden)}
          >
            <Sun size={14} />
          </div>
          <div
            {...stylex.props(styles.icon, theme === 'dark' ? styles.visible : styles.moonHidden)}
          >
            <Moon size={14} />
          </div>
          <div
            {...stylex.props(
              styles.icon,
              theme === 'system' ? styles.visible : styles.systemHidden,
            )}
          >
            <Monitor size={14} />
          </div>
        </div>
      </button>

      <a
        href={METAKIP_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        {...stylex.props(styles.externalLink)}
        title="Documentation"
        aria-label="Documentation"
      >
        <BookOpen size={14} />
      </a>

      <a
        href={METAKIP_GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        {...stylex.props(styles.externalLink)}
        title="GitHub Repository"
      >
        <Github size={14} />
      </a>
    </div>
  );
}
