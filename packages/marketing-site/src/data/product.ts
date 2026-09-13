import { APP_ORIGIN, DOCS_ORIGIN, GITHUB_URL, SITE_ORIGIN } from './siteConfig';

export const PRODUCT_SUMMARY =
  'A shared knowledge base for humans and agents. The same information exposed through the browser, MCP, CLI, or API.';

export const PRODUCT_ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${SITE_ORIGIN}/#organization`,
  name: 'Metakip',
  url: SITE_ORIGIN,
  sameAs: [GITHUB_URL],
} as const;

export const PRODUCT_WEBSITE = {
  '@type': 'WebSite',
  '@id': `${SITE_ORIGIN}/#website`,
  name: 'Metakip',
  url: SITE_ORIGIN,
  description: PRODUCT_SUMMARY,
  publisher: { '@id': `${SITE_ORIGIN}/#organization` },
} as const;

export const PRODUCT_APPLICATION = {
  '@type': 'WebApplication',
  '@id': `${SITE_ORIGIN}/#application`,
  name: 'Metakip',
  url: APP_ORIGIN,
  description: PRODUCT_SUMMARY,
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  softwareHelp: `${DOCS_ORIGIN}/`,
  license: `${GITHUB_URL}/blob/master/LICENSE`,
} as const;
