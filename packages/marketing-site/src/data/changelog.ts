import type { MarketingLink } from './marketingContent';
import { DOCS_ORIGIN, GITHUB_URL } from './siteConfig';

export const CHANGELOG_TITLE = 'Changelog';
export const CHANGELOG_DESCRIPTION =
  'Follow product updates across the Metakip browser app, CLI, API, sharing, and documentation.';
export const CHANGELOG_INTRO =
  'Metakip is in public beta. This changelog tracks the product updates that make the same pages more useful for people, terminals, and AI assistants.';

const changelogDateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long',
  timeZone: 'UTC',
});

export const formatChangelogDate = (date: string): string =>
  changelogDateFormatter.format(new Date(`${date}T00:00:00Z`));

export interface ChangelogEntry {
  id: string;
  date: string;
  title: string;
  details: readonly string[];
  links: readonly MarketingLink[];
}

const pullRequestLink = (number: number): MarketingLink => ({
  kind: 'external',
  label: `View PR #${number} →`,
  url: `${GITHUB_URL}/pull/${number}`,
});

const commitLink = (hash: string): MarketingLink => ({
  kind: 'external',
  label: `View Commit ${hash} →`,
  url: `${GITHUB_URL}/commit/${hash}`,
});

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    id: 'large-document-editing',
    date: '2026-09-27',
    title: 'Smoother editing for larger pages',
    details: [
      'Live Markdown previews and table layouts now stay more consistent as you move through long pages.',
      'Heading navigation, table editing, and formatting commands behave more predictably while you write.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read About Markdown Support →',
        url: `${DOCS_ORIGIN}/getting-started/markdown-support/`,
      },
      pullRequestLink(162),
    ],
  },
  {
    id: 'managed-image-uploads',
    date: '2026-09-26',
    title: 'Add images without leaving your page',
    details: [
      'Paste, drop, or select an image in the editor to upload it as a private, managed attachment.',
      'The CLI and API can upload images to a page too, and image-aware imports and exports help keep attachments with your content.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read About Images In Markdown →',
        url: `${DOCS_ORIGIN}/getting-started/markdown-support/`,
      },
      {
        kind: 'external',
        label: 'Read The CLI Guide →',
        url: `${DOCS_ORIGIN}/agents/metakip-cli/`,
      },
      pullRequestLink(161),
    ],
  },
  {
    id: 'reliable-inline-formatting',
    date: '2026-09-23',
    title: 'Keep your writing flow while formatting',
    details: [
      'Inline formatting shortcuts now behave more reliably as you finish bold, italic, and other formatted text.',
      'The editor handles tricky cursor positions, escaped markers, and trailing spaces more consistently.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read About Markdown Support →',
        url: `${DOCS_ORIGIN}/getting-started/markdown-support/`,
      },
      pullRequestLink(160),
    ],
  },
  {
    id: 'live-markdown-editor',
    date: '2026-09-12',
    title: 'A refreshed live Markdown editor',
    details: [
      'The editor now presents Markdown in a live-preview writing experience while keeping the underlying page content portable.',
      'Headings, formatting, tables, links, math, and real-time collaboration remain part of the same editing workflow.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Explore Markdown Support →',
        url: `${DOCS_ORIGIN}/getting-started/markdown-support/`,
      },
      pullRequestLink(158),
    ],
  },
  {
    id: 'page-title-search-everywhere',
    date: '2026-09-02',
    title: 'Search page titles across tools',
    details: [
      'Title search is now available to API, CLI, and MCP workflows, so people and assistants can locate pages from the tools they already use.',
      'Results are relevance-ordered, include folder paths, and are limited to pages the connected user can access.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read The CLI Guide →',
        url: `${DOCS_ORIGIN}/agents/metakip-cli/`,
      },
      {
        kind: 'external',
        label: 'Read About Metakip MCP →',
        url: `${DOCS_ORIGIN}/agents/mcp/`,
      },
      pullRequestLink(156),
    ],
  },
  {
    id: 'mcp-support',
    date: '2026-08-30',
    title: 'Connect Metakip through MCP',
    details: [
      'Metakip now supports MCP through an OAuth connection to the same knowledge base available in the browser, CLI, and API.',
      'Scoped access keeps operations within the permissions granted during authorization, with read and write access handled separately.',
      'MCP is available at `https://mcp.metakip.com/mcp`; the MCP guide covers connection details, protocol behavior, and self-hosting configuration.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read About Metakip MCP →',
        url: `${DOCS_ORIGIN}/agents/mcp/`,
      },
      pullRequestLink(152),
    ],
  },
  {
    id: 'workspace-gets-its-own-home',
    date: '2026-08-22',
    title: 'The workspace gets its own home',
    details: [
      'The browser app now has a dedicated space for signing in, creating pages, and collaborating with a workspace.',
      'The transition from learning about Metakip to using it is clearer: when you are ready to work, go straight to the workspace.',
    ],
    links: [{ kind: 'app', label: 'Open The Metakip App →' }, pullRequestLink(149)],
  },
  {
    id: 'hosted-documentation',
    date: '2026-08-17',
    title: 'Hosted documentation for the whole workflow',
    details: [
      'The new documentation site brings the first steps into one place: create a page, import notes, organize folders, and share access.',
      'When you are ready to go deeper, the same site covers the CLI, API, AI assistant workflows, and self-hosting.',
    ],
    links: [
      { kind: 'external', label: 'Read The Documentation →', url: `${DOCS_ORIGIN}/` },
      pullRequestLink(142),
      pullRequestLink(143),
    ],
  },
  {
    id: 'guided-onboarding-and-folder-imports',
    date: '2026-08-10',
    title: 'A clearer first session and broader imports',
    details: [
      'Guided setup gives new users a clear path from an empty workspace to imported notes and a connected agent workflow.',
      'markdown folder imports now join single-file and Obsidian vault imports, making it easier to bring an existing workspace without flattening it first.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Bring Your Notes To Metakip →',
        url: `${DOCS_ORIGIN}/getting-started/bring-your-notes/`,
      },
      {
        kind: 'external',
        label: 'Use Metakip With AI Assistants →',
        url: `${DOCS_ORIGIN}/agents/use-metakip-with-ai-assistants/`,
      },
      pullRequestLink(141),
    ],
  },
  {
    id: 'more-reliable-obsidian-imports',
    date: '2026-08-09',
    title: 'More reliable Obsidian imports',
    details: [
      'Notes with empty tag metadata can now be imported without treating an empty field as an error.',
      'This keeps migration focused on the content instead of requiring frontmatter cleanup first.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Bring Your Notes To Metakip →',
        url: `${DOCS_ORIGIN}/getting-started/bring-your-notes/`,
      },
      pullRequestLink(140),
    ],
  },
  {
    id: 'better-cli-feedback-and-diagnostics',
    date: '2026-08-08',
    title: 'Better feedback from the CLI',
    details: [
      'Doctor and whoami now show resolved configuration and token access, making it easier to understand the environment before a command runs.',
      'Commands, imports, exports, updates, and installers report progress and structured outcomes more clearly for both people and scripts.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read The Metakip CLI Guide →',
        url: `${DOCS_ORIGIN}/agents/metakip-cli/`,
      },
      pullRequestLink(135),
    ],
  },
  {
    id: 'cli-page-and-folder-lifecycle',
    date: '2026-08-03',
    title: 'Manage pages and folders from the terminal',
    details: [
      'The CLI now handles the content lifecycle from a terminal: create, inspect, move, remove, restore, import, and export pages and folders.',
      'Explicit confirmations, failure reporting, and machine-readable output make those operations usable by both people and scripts.',
      'Because the CLI and browser share a workspace model, teams can switch interfaces without maintaining a second copy.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read The Metakip CLI Guide →',
        url: `${DOCS_ORIGIN}/agents/metakip-cli/`,
      },
      {
        kind: 'external',
        label: 'Review Import And Export Guidance →',
        url: `${DOCS_ORIGIN}/getting-started/bring-your-notes/`,
      },
      pullRequestLink(128),
    ],
  },
  {
    id: 'safe-agent-content-workflows',
    date: '2026-08-01',
    title: 'Safer workflows for agents',
    details: [
      'Agents can make targeted content changes with preconditions and idempotency instead of relying on blind writes.',
      'Diagnostics and skill workflows expose access, configuration, and supported operations before an agent changes content.',
      'When a write outcome is uncertain, the workflow avoids automatic retries that could duplicate a change.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Learn About AI Assistant Access →',
        url: `${DOCS_ORIGIN}/agents/use-metakip-with-ai-assistants/`,
      },
      {
        kind: 'external',
        label: 'Read The CLI Guide →',
        url: `${DOCS_ORIGIN}/agents/metakip-cli/`,
      },
      pullRequestLink(123),
    ],
  },
  {
    id: 'metakip-cli-for-humans-and-agents',
    date: '2026-07-28',
    title: 'The Metakip CLI arrives',
    details: [
      'The standalone CLI gives people and agents a terminal interface to the same pages they use in the browser.',
      'Authenticated workflows, safe content editing, shell completion, and platform installers make the first terminal session practical.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Install And Use The CLI →',
        url: `${DOCS_ORIGIN}/agents/metakip-cli/`,
      },
      pullRequestLink(122),
    ],
  },
  {
    id: 'automatic-url-linking',
    date: '2026-07-27',
    title: 'Links become part of the writing flow',
    details: [
      'Typed and pasted URLs now become links without interrupting the editor workflow.',
      'Link handling respects code, formatting, and document boundaries instead of changing content that should remain plain text.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read About markdown Support →',
        url: `${DOCS_ORIGIN}/getting-started/markdown-support/`,
      },
      pullRequestLink(119),
    ],
  },
  {
    id: 'favorites-on-dashboard',
    date: '2026-07-26',
    title: 'Keep important pages close at hand',
    details: [
      'Favorite pages and folders now appear alongside the rest of the workspace on the home dashboard.',
      'Favorites keep frequently used knowledge within reach while preserving the existing access and collaboration controls.',
    ],
    links: [{ kind: 'app', label: 'Open The Metakip App →' }, pullRequestLink(114)],
  },
  {
    id: 'sharing-and-real-time-permissions',
    date: '2026-07-24',
    title: 'Share pages and folders with clear permissions',
    details: [
      'Pages and folders can now be shared with View, Edit, and Admin roles, so collaborators get the access they need without a complicated permission model.',
      'Real-time permission changes keep active sessions aligned as access changes.',
      'When access is lost or a collaboration connection becomes stale, read-only behavior protects the document from unsafe edits.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read About Sharing A Page →',
        url: `${DOCS_ORIGIN}/getting-started/share-a-page/`,
      },
      pullRequestLink(107),
    ],
  },
  {
    id: 'self-hosting-and-migration-guidance',
    date: '2026-06-02',
    title: 'A clearer path to self-hosting',
    details: [
      'Deployment checks and health reporting now make rollouts easier to verify before the application is restarted.',
      'The deployment documentation includes a migration guide for moving a Metakip deployment between servers.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read The Self-Hosting Guide →',
        url: `${DOCS_ORIGIN}/self-hosting/`,
      },
      pullRequestLink(103),
    ],
  },
  {
    id: 'markdown-editor-and-export-upgrades',
    date: '2026-05-19',
    title: 'A more capable markdown editor',
    details: [
      'Properties support drag-and-drop ordering, inline editing, autocomplete, tags, and richer values.',
      'Keyboard shortcuts and slash commands make common editor actions faster to discover and repeat.',
      'Tables support insertion, keyboard navigation, and CSV or TSV paste.',
      'markdown exports now preserve more formatting and can bundle referenced images as local assets.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Read About markdown Support →',
        url: `${DOCS_ORIGIN}/getting-started/markdown-support/`,
      },
      pullRequestLink(38),
      pullRequestLink(59),
      pullRequestLink(68),
      pullRequestLink(70),
    ],
  },
  {
    id: 'connected-pages-and-collaboration-presence',
    date: '2026-05-10',
    title: 'Connected pages and visible collaboration',
    details: [
      'Wiki links can suggest pages as you write, resolve to stable targets, and update backlinks when documents change.',
      'Collaborative cursors, user avatars, and connection status make it clear who is working in a page with you.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Organize Pages And Folders →',
        url: `${DOCS_ORIGIN}/getting-started/organize-pages-and-folders/`,
      },
      pullRequestLink(40),
      pullRequestLink(42),
    ],
  },
  {
    id: 'markdown-first-workspace-foundations',
    date: '2026-04-30',
    title: 'The markdown-first workspace takes shape',
    details: [
      'Folders, tags, page links, backlinks, uploads, and the workspace explorer give pages a durable structure.',
      'The editor moved to a markdown-centered foundation, with an Obsidian import flow for bringing existing notes into the workspace.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Bring Your Notes To Metakip →',
        url: `${DOCS_ORIGIN}/getting-started/bring-your-notes/`,
      },
      {
        kind: 'external',
        label: 'Organize Pages And Folders →',
        url: `${DOCS_ORIGIN}/getting-started/organize-pages-and-folders/`,
      },
      commitLink('5767289'),
      commitLink('609f2a1'),
      commitLink('7dbabfe'),
      commitLink('99c9e8b'),
    ],
  },
  {
    id: 'workspace-basics-and-content-recovery',
    date: '2026-02-22',
    title: 'The workspace gets its essential tools',
    details: [
      'Search, favorites, recent pages, and Trash make it easier to find, recover, and organize work as a workspace grows.',
      'Public pages, page links, mentions, raw markdown viewing, and export connect writing with sharing and portability.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Create Your First Page →',
        url: `${DOCS_ORIGIN}/getting-started/create-your-first-page/`,
      },
      commitLink('3dcf2aa'),
      commitLink('39801f5'),
    ],
  },
  {
    id: 'metakip-mvp',
    date: '2026-02-20',
    title: 'The first Metakip workspace',
    details: [
      'The first working product brought together authentication, a browser editor, page persistence, workspace navigation, and collaboration.',
      'Import and export workflows, workspace management, member invites, search, and a deployable application established the foundation for what followed.',
    ],
    links: [
      {
        kind: 'external',
        label: 'Create Your First Page →',
        url: `${DOCS_ORIGIN}/getting-started/create-your-first-page/`,
      },
      commitLink('68a438d'),
      commitLink('f88ec20'),
    ],
  },
];
