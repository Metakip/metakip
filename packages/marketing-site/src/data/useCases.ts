import type { MarketingHtmlPageDefinition, MarketingLink } from './marketingContent';
import { richText } from './richText';
import { DOCS_ORIGIN } from './siteConfig';

export const USE_CASES = [
  {
    id: 'individuals',
    title: 'For individuals building a personal knowledge base.',
    body: richText({
      kind: 'text',
      value:
        'Capture notes, ideas, plans, and reference material on pages you can connect and revisit. Import markdown files or an Obsidian vault, then use folders, tags, links, and backlinks to keep your knowledge navigable.',
    }),
    link: {
      kind: 'external',
      label: 'Read About Importing Notes →',
      url: `${DOCS_ORIGIN}/getting-started/bring-your-notes/`,
    } satisfies MarketingLink,
  },
  {
    id: 'teams',
    title: 'For teams creating a shared knowledge base.',
    body: richText({
      kind: 'text',
      value:
        'Share project notes, decisions, research, and plans with the people who need them. View, Edit, and Admin access make sharing clear, while real-time editing keeps collaboration in one place.',
    }),
    link: {
      kind: 'external',
      label: 'Read About Sharing →',
      url: `${DOCS_ORIGIN}/getting-started/share-a-page/`,
    } satisfies MarketingLink,
  },
  {
    id: 'writers-researchers',
    title: 'For writers and researchers connecting ideas.',
    body: richText(
      {
        kind: 'text',
        value:
          'Keep sources, drafts, questions, and discoveries connected as your work develops. Link related pages with ',
      },
      { kind: 'code', value: '[[Page Name]]' },
      {
        kind: 'text',
        value: ', then follow backlinks to retrace how an idea, source, or decision fits together.',
      },
    ),
    link: {
      kind: 'external',
      label: 'Read About Pages And Folders →',
      url: `${DOCS_ORIGIN}/getting-started/organize-pages-and-folders/`,
    } satisfies MarketingLink,
  },
  {
    id: 'developers',
    title: 'For developers and technical teams working in markdown.',
    body: richText({
      kind: 'text',
      value:
        'Write in the browser, work from a terminal with the CLI, and connect scripts through the API. The same pages remain available across each interface, so technical context does not get trapped in one tool.',
    }),
    link: {
      kind: 'external',
      label: 'Read About The CLI →',
      url: `${DOCS_ORIGIN}/agents/metakip-cli/`,
    } satisfies MarketingLink,
  },
  {
    id: 'ai-assisted',
    title: 'For people and teams using AI assistants.',
    body: richText({
      kind: 'text',
      value:
        'Give an AI assistant read access to the pages it needs instead of copying context into a second store. Add write access when the workflow calls for it, and use exact edits when a change should be controlled.',
    }),
    link: {
      kind: 'external',
      label: 'Read About Agent Access →',
      url: `${DOCS_ORIGIN}/agents/use-metakip-with-ai-assistants/`,
    } satisfies MarketingLink,
  },
] as const;

export const USE_CASE_PAGE = {
  title: 'Built for people and agents.',
  intro: [
    'A collaborative markdown knowledge base for individuals, teams, developers, writers, researchers, and AI-assisted workflows. Write, organize, and share the same pages across the browser, terminal, and API.',
  ],
  sections: USE_CASES,
  closing: 'Start with a page, bring in your existing notes, or share a workspace with your team.',
  footerTitle: 'Next step',
  footerLinks: [
    { kind: 'app', label: 'Open Metakip' },
    { kind: 'internal', label: 'Read The Features', path: '/features' },
  ],
} satisfies MarketingHtmlPageDefinition;
