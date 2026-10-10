export function getApplicationFaviconHref(): string {
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return `/icon-${theme}-192.png`;
}

export function resetDocumentMetadata(): void {
  document.title = 'Metakip';

  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) {
    favicon.dataset.themeIcon = '192';
    favicon.href = getApplicationFaviconHref();
  }

  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.remove();
}
