import { METAKIP_CLI_DOCS_URL, METAKIP_DOCS_URL, METAKIP_GITHUB_URL } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor } from '../db/query';
import { createPage } from './pageCreation';

export const WELCOME_PAGE_TITLE = 'Hey, Welcome to Metakip!';

export const WELCOME_PAGE_CONTENT = `Hi! I'm Atharva, the sole developer behind Metakip. Thank you from the bottom of my heart for deciding to use my app. You can DM me on [X](https://x.com/atharva_again) or [LinkedIn](https://www.linkedin.com/in/atharva-again/), or email me at [atharva.verma18@gmail.com](mailto:atharva.verma18@gmail.com) for feedback or questions. You can also browse the [Metakip documentation](${METAKIP_DOCS_URL}) for guides and feature details.

Metakip can do almost anything that existing note-taking apps can do.

Oh, and before I forget to mention, it's fully open source so you can self-host it too if you want. I'm running this app on a VPS myself. Head over to the [GitHub repo](${METAKIP_GITHUB_URL}) (and leave a star please) to learn more.

Feel free to delete this page whenever you want.

## Features Supported

1. Slash menu (type / to activate it)
2. Image uploads
3. Automatic md file or folder imports and Obsidian vault import
4. Backlinks / wikilinks
5. Properties
6. Sharing and real-time collaboration
7. A [CLI](${METAKIP_CLI_DOCS_URL}) for you and your agents to work with Metakip
8. Table of contents (hover over the bars on the right for more details)
9. Exporting to md
10. Favorites
11. Command palette and search
12. Light and dark themes
13. Trash and restore
14. Tables and math

## Upcoming Features

1. First-class support for importing from more note-taking apps
2. Metakip MCP
3. Version history

## Importing md / Obsidian Vault

Open Settings from the bottom of the sidebar to find the Obsidian vault importer. You can use the same importer for regular md folders too.

To import one md file, use the import icon at the top of the sidebar.

## Agentic Works

If you use coding agents like Pi, Codex, or Claude Code, the CLI is especially useful: you and your agents can write and collaborate together.

## Shortcuts

Metakip includes keyboard shortcuts for power users. They are not configurable yet.

| Action | Linux / Windows | macOS |
| --- | --- | --- |
| Toggle sidebar | Ctrl + / | ⌘ + / |
| Open command palette | Ctrl + K | ⌘ + K |
| Create page | Alt + N | ⌥ + N |
| Create folder | Alt + Shift + N | ⌥ + ⇧ + N |
| Toggle theme | Ctrl + Shift + D | ⌘ + ⇧ + D |
| Paragraph | Ctrl + Alt + 0 | ⌘ + ⌥ + 0 |
| Heading 1–6 | Ctrl + Alt + 1–6 | ⌘ + ⌥ + 1–6 |
| Bold | Ctrl + B | ⌘ + B |
| Italic | Ctrl + I | ⌘ + I |
| Strikethrough | Ctrl + Shift + X | ⌘ + ⇧ + X |
| Inline code | Ctrl + Shift + F | ⌘ + ⇧ + F |
| Blockquote | Ctrl + Shift + B | ⌘ + ⇧ + B |
| Link | Ctrl + K | ⌘ + K |
| Bullet list | Ctrl + Alt + 8 | ⌘ + ⌥ + 8 |
| Ordered list | Ctrl + Alt + 7 | ⌘ + ⌥ + 7 |
| Task list | Ctrl + Alt + 9 | ⌘ + ⌥ + 9 |
| Image | Ctrl + Shift + I | ⌘ + ⇧ + I |
| Tag | Ctrl + Shift + # | ⌘ + ⇧ + # |
`;

export async function createWelcomePageForUser(
  executor: QueryExecutor,
  userId: string,
): Promise<void> {
  const { page } = await createPage(executor, {
    actor: { kind: 'user', id: userId },
    parentId: null,
    title: WELCOME_PAGE_TITLE,
    icon: '👋',
    content: {
      kind: 'markdown',
      body: WELCOME_PAGE_CONTENT,
      properties: {
        author: 'Atharva Verma',
        url: 'https://atharvaverma.dev/',
        tags: ['metakip', 'welcome'],
      },
    },
  });

  await executeQuery(
    executor,
    sql`insert into user_favorites (user_id, entity_type, entity_id)
        values (${userId}, 'page', ${page.id})`,
  );
}
