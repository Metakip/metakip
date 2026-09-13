import type { FeatureImageId } from './featureMedia';
import type { MarketingLink } from './marketingContent';
import { type RichText, richText } from './richText';
import { DOCS_ORIGIN } from './siteConfig';

export type FeatureMediaAsset =
  | {
      kind: 'video';
      lightUrl: string;
      darkUrl: string;
      type: 'video/mp4' | 'video/webm';
      alt: string;
    }
  | {
      kind: 'image';
      imageId: FeatureImageId;
    };

export type FeatureMedia = readonly FeatureMediaAsset[];

export type FeatureGroup = {
  id: string;
  title: string;
  body: RichText;
  media: FeatureMedia;
  link: MarketingLink;
};

export const FEATURE_GROUPS = [
  {
    id: 'same-pages',
    title: 'One page. Every way to work.',
    body: richText({
      kind: 'text',
      value:
        'Write in the browser, read from the terminal, or let an agent make a targeted edit. Everyone reaches the same page, so there is no second copy to sync and no wrapper to maintain.',
    }),
    media: [
      { kind: 'image', imageId: 'browser-page' },
      { kind: 'image', imageId: 'terminal-page' },
    ],
    link: {
      kind: 'external',
      label: 'Read About The CLI →',
      url: `${DOCS_ORIGIN}/agents/metakip-cli/`,
    },
  },
  {
    id: 'real-time',
    title: 'Work together without losing control.',
    body: richText({
      kind: 'text',
      value:
        'Give collaborators View, Edit, or Admin access. When they are connected, everyone can edit the same page in real time and see the collaboration status. If the connection drops, Metakip switches to read-only instead of accepting edits against stale content.',
    }),
    media: [
      {
        kind: 'video',
        lightUrl: '/videos/collab-light.mp4',
        darkUrl: '/videos/collab-dark.mp4',
        type: 'video/mp4',
        alt: 'A Metakip page being edited collaboratively in real time.',
      },
      { kind: 'image', imageId: 'invite-access' },
    ],
    link: {
      kind: 'external',
      label: 'Read About Sharing →',
      url: `${DOCS_ORIGIN}/getting-started/share-a-page/`,
    },
  },
  {
    id: 'connected-knowledge',
    title: 'Keep the context with the content.',
    body: richText(
      { kind: 'text', value: 'Link to another page with ' },
      { kind: 'code', value: '[[Page Name]]' },
      {
        kind: 'text',
        value:
          '. Folders keep related pages together; backlinks show how a page is used elsewhere. Your notes become a path through the subject, not a collection of isolated files.',
      },
    ),
    media: [
      {
        kind: 'video',
        lightUrl: '/videos/backlink-light.mp4',
        darkUrl: '/videos/backlink-section.mp4',
        type: 'video/mp4',
        alt: 'A Metakip page showing linked knowledge and backlinks.',
      },
    ],
    link: {
      kind: 'external',
      label: 'Read About Pages And Folders →',
      url: `${DOCS_ORIGIN}/getting-started/organize-pages-and-folders/`,
    },
  },
  {
    id: 'careful-agents',
    title: 'Give agents boundaries, not a blank check.',
    body: richText({
      kind: 'text',
      value:
        'Create a named API token and start with read access. When an assistant needs to write, the CLI can make an exact replacement on the current page. It refuses to guess when the passage is missing, repeated, or has changed—so automation does not become a silent rewrite.',
    }),
    media: [
      {
        kind: 'video',
        lightUrl: '/videos/token-light.webm',
        darkUrl: '/videos/token-dark.webm',
        type: 'video/webm',
        alt: 'A Metakip API token set up with scoped access.',
      },
    ],
    link: {
      kind: 'external',
      label: 'Read About Agent Access →',
      url: `${DOCS_ORIGIN}/agents/use-metakip-with-ai-assistants/`,
    },
  },
  {
    id: 'portable-knowledge',
    title: 'Keep your notes portable.',
    body: richText({
      kind: 'text',
      value:
        'Import one markdown file, a folder, or an Obsidian vault. Export a page or the whole workspace from the CLI. Use Metakip as a hosted service, or run the open-source application on infrastructure you control.',
    }),
    media: [
      { kind: 'image', imageId: 'obsidian-import' },
      { kind: 'image', imageId: 'workspace-export' },
    ],
    link: {
      kind: 'external',
      label: 'Read About Self-Hosting →',
      url: `${DOCS_ORIGIN}/self-hosting/`,
    },
  },
] satisfies readonly FeatureGroup[];

export const FAQS = [
  {
    question: 'Is Metakip only for AI agents?',
    answer:
      'No. Metakip is for people first, with the CLI and API as direct ways for terminals, scripts, and AI assistants to use the same pages.',
  },
  {
    question: 'How do people and agents share a page?',
    answer:
      'They use the same content layer. A person can write in the browser while a terminal or assistant reads and edits that page through the CLI or API.',
  },
  {
    question: 'Does Metakip use markdown for page content?',
    answer:
      'Yes. Page content remains markdown across the browser, CLI, and API. Titles and access settings are stored separately as page metadata.',
  },
  {
    question: 'Can I bring existing notes?',
    answer:
      'Yes. Import one markdown file, a markdown folder, or an Obsidian vault. Keep the original copy until representative titles, links, images, and folders have been verified.',
  },
  {
    question: 'Can I self-host Metakip?',
    answer:
      'Yes. Metakip is open source under GNU AGPL v3 and includes a documented deployment path for a VPS with Caddy, Podman, and PostgreSQL.',
  },
] as const;
