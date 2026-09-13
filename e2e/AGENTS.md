# AGENTS.md — E2E Tests (Playwright)

## Running Tests

**Always run from the `e2e/` directory, not the project root:**

```bash
cd e2e
npx playwright test                         # all tests
npx playwright test editor/slash-menu.spec.ts  # single file
```

The config at `e2e/playwright.config.ts` uses relative paths (`./playwright/.auth/user.json`) that resolve correctly only when CWD is `e2e/`.

## Prerequisites

### 1. PostgreSQL

A PostgreSQL container must be running on `localhost:5432` with:
- User: `metakip`
- Password: `password`
- Database: `metakip`

The dev container is named `metakip-postgres-dev`. Start it:

```bash
# From project root
pnpm db:start
```

### 2. Database Schema

Apply pending migrations if the schema is not initialized:

```bash
# From project root
DATABASE_URL=postgresql://metakip:password@localhost:5432/metakip pnpm --filter @metakip/api db:migrate
```

`db:push` is disabled in this repository. Tests must run against the checked-in migration history.

### 3. Dev Servers

Both API (port 3001) and Vite dev server (port 5173) must be running:

```bash
# From project root — this starts API, collab, and web in parallel
pnpm dev
```

The `.env` file at the project root is loaded automatically by `packages/api/src/env.ts`. Required env vars:

| Variable | Example |
|---|---|
| `DATABASE_URL` | `postgresql://metakip:password@localhost:5432/metakip` |
| `BETTER_AUTH_SECRET` | (at least 32 chars) |
| `FRONTEND_URL` | `http://localhost:5173` |
| `PORT` | `3001` |
| `NODE_ENV` | `development` |

`TEST_SETUP_TOKEN` is required and must match the value configured on the API process.

### 4. Playwright Browsers

```bash
cd e2e
npx playwright install chromium firefox
```

## Auth Setup Gotchas

### How Auth Works

The setup test (`auth.setup.ts`) calls `POST /api/test/setup` with `TEST_SETUP_TOKEN`, which:
1. Creates a uniquely identified test user
2. Creates a signed session cookie
3. Navigates to the app root (`/`)
4. Saves browser storage state to `e2e/playwright/.auth/user.json`

Subsequent tests load this storage state to be authenticated. Each setup call uses a unique email address, so repeated runs do not collide with a fixed workspace slug.

### Stale Authentication State

Delete the cached auth state when switching databases or after clearing local test data:

```bash
rm -f e2e/playwright/.auth/user.json
```

### Auth File Path

The auth setup writes to `e2e/playwright/.auth/user.json` (using `__dirname`). The config reads from `./playwright/.auth/user.json`. Both resolve to the same absolute path as long as CWD is `e2e/`.

If you see `ENOENT: no such file or directory, open './playwright/.auth/user.json'`, you're likely running from the wrong directory.

## CI vs Local Differences

| Aspect | CI | Local |
|---|---|---|
| PostgreSQL | GitHub Actions `postgresql` service (pinned image, health checked, fresh per job) | `metakip-postgres-dev` Podman container (persistent) |
| Database state | Empty — migrations applied fresh | Has leftover test data |
| Working directory | `e2e/` | Must be `e2e/` |
| TEST_SETUP_TOKEN | Set to `e2e-test-setup-secret` | Required; must match the API process |

## Writing Tests

### Patterns

All existing E2E tests follow this pattern:

```typescript
import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test('my test', async ({ page }) => {
  await createNewPage(page);   // navigates to app, creates a new page
  await focusEditor(page);     // clicks on the CodeMirror content DOM
  // ...interact with editor...
  await expect(page.locator('.cm-md-heading-1')).toBeVisible();
});
```

### Selectors

- Editor content: `.codemirror-editor .cm-content`
- Slash menu: `[data-testid="slash-menu"]`
- Wiki link suggestions: `[data-testid="wikilink-suggestions"]`
- Floating toolbar buttons: `.floating-toolbar button[title="..."]`
- Page title input: `input[data-testid="page-title"]`
- Headings: `.cm-md-heading-1` through `.cm-md-heading-6`
- Bold: `.cm-md-strong`
- Italic: `.cm-md-emphasis`
- Blockquote: `.cm-md-blockquote`
- Lists: `.cm-md-list-marker`
- Task list: `.cm-md-task-checkbox`
- Table: `.cm-md-table`
- Divider: `.cm-md-divider`

### Slash Menu Specifics

- The slash menu renders as a fixed-position popup with `data-testid="slash-menu"`
- Commands are `<button>` elements inside the menu container
- The first visible item (index 0) is "Paragraph" when no filter is active
- Fuse.js fuzzy search with threshold 0.35 is used for filtering
- Keyboard: ArrowDown/ArrowUp cycle through items; Enter selects; Escape closes
- Click-outside also closes the menu
- After selecting a command, the `/query` text is removed from the editor
- The menu container shows "No matching commands" when the query matches nothing
