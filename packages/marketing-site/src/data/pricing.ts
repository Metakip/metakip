import type { MarketingHtmlPageDefinition, MarketingSectionWithId } from './marketingContent';
import { richText } from './richText';
import { DOCS_ORIGIN, GITHUB_URL } from './siteConfig';

export const PRICING_PAGE = {
  title: 'Free for now.',
  description: 'Metakip is free during public beta, with no paid plans yet.',
  intro: ['Metakip is free during public beta, with no paid plans yet.'],
  sections: [
    {
      id: 'hosted',
      title: 'Hosted Metakip',
      body: richText({
        kind: 'text',
        value:
          'Use the hosted Metakip app in your browser, then reach the same pages from the CLI or API. The hosted service is free during the public beta.',
      }),
      link: { kind: 'app', label: 'Open Metakip' },
    },
    {
      id: 'self-hosted',
      title: 'Self-host Metakip',
      body: richText({
        kind: 'text',
        value:
          'Metakip is open source under GNU AGPL v3. Run it on infrastructure you control. The software is free to self-host; your infrastructure and operations remain yours.',
      }),
      link: {
        kind: 'external',
        label: 'Read About Self-Hosting',
        url: `${DOCS_ORIGIN}/self-hosting/`,
      },
    },
    {
      id: 'no-ladder-yet',
      title: 'No plan comparison yet',
      body: richText({
        kind: 'text',
        value:
          'We are not publishing paid tiers or usage limits while we learn which hosted workflows matter most. When pricing changes, this page will explain what is included and what it costs.',
      }),
      link: { kind: 'internal', label: 'Read The Features', path: '/features' },
    },
  ],
  closing: 'Start with a page and see whether Metakip fits your workflow.',
  footerTitle: 'Explore Metakip',
  footerLinks: [
    { label: 'See The Use Cases', path: '/use-cases', kind: 'internal' },
    { label: 'View The Source Code', url: GITHUB_URL, kind: 'external' },
  ],
} satisfies MarketingHtmlPageDefinition & {
  description: string;
  sections: readonly MarketingSectionWithId[];
};
