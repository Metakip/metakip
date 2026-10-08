type Theme = 'light' | 'dark' | 'system';

const isTheme = (value: string | null): value is Theme =>
  value === 'light' || value === 'dark' || value === 'system';

const readTheme = (): Theme => {
  const storedTheme = localStorage.getItem('metakip-theme');
  return isTheme(storedTheme) ? storedTheme : 'system';
};

export const initializeThemeController = (): void => {
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const boundOptions = new WeakSet<HTMLButtonElement>();
  const applyTheme = (theme: Theme, persist: boolean): void => {
    const isDark = theme === 'dark' || (theme === 'system' && systemTheme.matches);
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDark ? '#090909' : '#ffffff');
    document.querySelectorAll<HTMLLinkElement>('[data-theme-icon]').forEach((icon) => {
      const size = icon.dataset.themeIcon;
      if (size) icon.href = `/icon-${isDark ? 'dark' : 'light'}-${size}.png`;
    });
    document.querySelectorAll<HTMLButtonElement>('[data-theme-option]').forEach((option) => {
      option.setAttribute('aria-pressed', String(option.dataset.themeOption === theme));
    });
    if (persist) localStorage.setItem('metakip-theme', theme);
    window.dispatchEvent(new CustomEvent('metakip-theme-change', { detail: isDark }));
  };
  const initialize = (): void => {
    const themeOptions = document.querySelectorAll<HTMLButtonElement>('[data-theme-option]');
    if (themeOptions.length !== 3) throw new Error('Three theme options are required');
    themeOptions.forEach((themeOption) => {
      if (!boundOptions.has(themeOption)) {
        boundOptions.add(themeOption);
        themeOption.addEventListener('click', () => {
          const selectedTheme = themeOption.dataset.themeOption ?? null;
          if (!isTheme(selectedTheme)) throw new Error('Theme option is invalid');
          applyTheme(selectedTheme, true);
        });
      }
    });
    applyTheme(readTheme(), false);
  };

  systemTheme.addEventListener('change', () => {
    if (readTheme() === 'system') applyTheme('system', false);
  });
  // Reapply before painting the new document to avoid a light-theme flash.
  document.addEventListener('astro:after-swap', () => applyTheme(readTheme(), false));
  document.addEventListener('astro:page-load', initialize);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
};
