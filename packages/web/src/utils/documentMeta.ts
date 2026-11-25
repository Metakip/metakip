export function getApplicationFaviconHref(): string {
  return '/icon-light-192.png';
}

export function resetDocumentMetadata(): void {
  document.title = 'Metakip';

  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) {
    favicon.href = getApplicationFaviconHref();
  }

  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.remove();
}
