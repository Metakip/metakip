export function resetDocumentMetadata(): void {
  document.title = 'Metakip';

  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) favicon.href = '/vite.svg';

  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.remove();
}
