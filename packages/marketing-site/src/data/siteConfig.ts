export const SITE_ORIGIN = 'https://metakip.com';
export const APP_ORIGIN = 'https://app.metakip.com';
export const DOCS_ORIGIN = 'https://docs.metakip.com';
export const GITHUB_URL = 'https://github.com/Metakip/metakip';
export const SITE_PAGES = [
  { href: '/', label: 'Home', includeInNavigation: false },
  { href: '/use-cases', label: 'Use Cases', includeInNavigation: true },
  { href: '/pricing', label: 'Pricing', includeInNavigation: true },
  { href: '/changelog', label: 'Changelog', includeInNavigation: false },
] as const;

export const SITE_NAVIGATION = SITE_PAGES.filter(({ includeInNavigation }) => includeInNavigation);
