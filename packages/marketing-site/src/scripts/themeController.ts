type Theme = 'light' | 'dark' | 'system';

const THEME_ORDER: readonly Theme[] = ['light', 'dark', 'system'];

const isTheme = (value: string | null): value is Theme =>
  value === 'light' || value === 'dark' || value === 'system';

const readTheme = (): Theme => {
  const storedTheme = localStorage.getItem('metakip-theme');
  return isTheme(storedTheme) ? storedTheme : 'system';
};

export const initializeThemeController = (): void => {
  const initialize = (): void => {
    const themeButton = document.querySelector<HTMLButtonElement>('[data-theme-button]');
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    const systemTheme = matchMedia('(prefers-color-scheme: dark)');

    if (!themeButton) throw new Error('Theme button is required');
    if (!themeColorMeta) throw new Error('Theme color metadata is required');

    const updateThemeButton = (theme: Theme): void => {
      themeButton.setAttribute('title', `Theme: ${theme}`);
    };
    const applyTheme = (theme: Theme, persist: boolean): void => {
      const isDark = theme === 'dark' || (theme === 'system' && systemTheme.matches);
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      themeColorMeta.setAttribute('content', isDark ? '#090909' : '#ffffff');
      if (persist) localStorage.setItem('metakip-theme', theme);
      updateThemeButton(theme);
      window.dispatchEvent(new CustomEvent('metakip-theme-change', { detail: isDark }));
    };

    themeButton.addEventListener('click', () => {
      const currentTheme = readTheme();
      const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme) + 1) % THEME_ORDER.length];
      if (!nextTheme) throw new Error('Theme order is missing a next theme');
      applyTheme(nextTheme, true);
    });
    systemTheme.addEventListener('change', () => {
      if (readTheme() === 'system') applyTheme('system', false);
    });

    applyTheme(readTheme(), false);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
};
