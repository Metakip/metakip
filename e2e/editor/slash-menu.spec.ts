import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test.describe('Slash menu', () => {
  test.describe('Trigger and visibility', () => {
    test('opens when / is typed at line start', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/');
      const menu = page.locator('[data-testid="slash-menu"]');
      await expect(menu).toBeVisible({ timeout: 5000 });
    });

    test('does not open when / is typed mid-word', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('abc/');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
    });

    test('shows all commands with empty query (just /)', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/');
      const menu = page.locator('[data-testid="slash-menu"]');
      await expect(menu).toBeVisible({ timeout: 5000 });
      const buttons = page.locator('[data-testid="slash-menu"] button');
      await expect(buttons.first()).toBeVisible();
      const count = await buttons.count();
      expect(count).toBeGreaterThan(10);
    });
  });

  test.describe('Search and filtering', () => {
    test('filters commands by fuzzy search', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });

      await page.keyboard.type('table');
      await expect(page.locator('[data-testid="slash-menu"]')).toContainText('Table');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toContainText(
        'No matching commands',
      );
    });

    test('shows no-match message for gibberish query', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/zzzzz');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="slash-menu"]')).toContainText(
        'No matching commands',
      );
    });
  });

  test.describe('Dismissal', () => {
    test('closes on Escape key', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
    });

    test('closes on click outside the menu', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.locator('input[data-testid="page-title"]').click({ timeout: 5000 });
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
    });
  });

  test.describe('Keyboard navigation', () => {
    test('ArrowDown cycles selection and Enter executes the selected command', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Keyboard Heading');
      await expect(page.locator('.cm-md-heading-1')).toContainText('Keyboard Heading', {
        timeout: 5000,
      });
    });
  });

  test.describe('Trigger cleanup', () => {
    test('removes the /query text after a command is selected', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/h2');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('Clean Text');
      await expect(page.locator('.cm-md-heading-2')).toContainText('Clean Text', { timeout: 5000 });
      await expect(page.locator('.codemirror-editor .cm-content')).not.toContainText('/h2');
    });
  });

  test.describe('Block commands', () => {
    test('inserts heading 1 via /h1', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/h1');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('Main Title');
      await expect(page.locator('.cm-md-heading-1')).toContainText('Main Title', { timeout: 5000 });
    });

    test('inserts blockquote via /blockquote', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/blockquote');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('Cited text');
      await expect(page.locator('.cm-md-blockquote')).toContainText('Cited text', {
        timeout: 5000,
      });
    });

    test('inserts bullet list via /bullet', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/bullet');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('List item');
      await expect(page.locator('.cm-md-list-marker')).toHaveText('•', { timeout: 5000 });
      await expect(page.locator('.codemirror-editor .cm-content')).toContainText('List item');
    });

    test('inserts ordered list via /ordered', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/ordered');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('First item');
      await expect(page.locator('.cm-md-list-marker')).toHaveText('1.', { timeout: 5000 });
      await expect(page.locator('.codemirror-editor .cm-content')).toContainText('First item');
    });

    test('inserts task list via /check', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/check');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('Task item');
      await expect(page.locator('.cm-md-task-checkbox')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.codemirror-editor .cm-content')).toContainText('Task item');
    });

    test('inserts table via /table', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/table');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await expect(page.locator('.cm-md-table')).toBeVisible({ timeout: 5000 });
    });

    test('inserts horizontal divider via /divider', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/divider');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await expect(page.locator('.cm-md-divider')).toBeVisible({ timeout: 5000 });
    });

    test('places the caret in a new paragraph below a divider', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/divider');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('Text below the divider');

      await expect(page.locator('.cm-line:has(.cm-md-divider) + .cm-line')).toHaveText(
        'Text below the divider',
      );
    });

    test('places the caret in a new paragraph below a typed divider', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('---');

      await expect(page.locator('.cm-md-divider')).toBeVisible({ timeout: 5000 });
      await page.keyboard.type('Text below the divider');

      await expect(page.locator('.cm-line:has(.cm-md-divider) + .cm-line')).toHaveText(
        'Text below the divider',
      );
    });
  });

  test.describe('Inline mark commands', () => {
    test('bold command applies bold to subsequent typing', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/bold');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
      await page.keyboard.type('bold text');
      await expect(page.locator('.cm-md-strong')).toContainText('bold text', {
        timeout: 5000,
      });
    });

    test('italic command applies italic to subsequent typing', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/italic');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
      await page.keyboard.type('italic text');
      await expect(page.locator('.cm-md-emphasis')).toContainText('italic text', {
        timeout: 5000,
      });
    });
  });

  test.describe('Sequential use', () => {
    test('can execute multiple slash commands one after another', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);

      await page.keyboard.type('/h1');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('First Section');
      await expect(page.locator('.cm-md-heading-1')).toContainText('First Section', {
        timeout: 5000,
      });

      await page.keyboard.press('Enter');
      await page.keyboard.type('/h2');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('Second Section');
      await expect(page.locator('.cm-md-heading-2')).toContainText('Second Section', {
        timeout: 5000,
      });

      await expect(page.locator('.cm-md-heading-1')).toHaveCount(1);
      await expect(page.locator('.cm-md-heading-2')).toHaveCount(1);
    });
  });

  test.describe('Regression', () => {
    test('wiki link [[ still triggers suggestions alongside slash menu', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);

      await page.keyboard.type('[[');
      const popup = page.getByTestId('wikilink-suggestions');
      await expect(popup).toBeVisible({ timeout: 5000 });

      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/h2');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('Heading from slash');
      await expect(page.locator('.cm-md-heading-2')).toContainText('Heading from slash', {
        timeout: 5000,
      });
    });
  });

  test.describe('Whitespace edge cases', () => {
    test('does not open when / is followed by a space', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/ ');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
    });

    test('closes slash menu when space is typed after a query', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/h1');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.type(' ');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
    });

    test('does not open when / appears mid-paragraph with surrounding spaces', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('rolling distribution has no / or after some interval');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
    });

    test('does not open for slash in a URL-like string', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('Check out https://example.com/page for details');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
    });

    test('closes menu when typing continues with space after slash command', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/h1');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.type(' more');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
    });

    test('can still trigger slash menu after dismissing from whitespace', async ({ page }) => {
      await createNewPage(page);
      await focusEditor(page);
      await page.keyboard.type('/ ');
      await expect(page.locator('[data-testid="slash-menu"]')).not.toBeVisible({ timeout: 2000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('/h2');
      await expect(page.locator('[data-testid="slash-menu"]')).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Enter');
      await page.keyboard.type('Still works');
      await expect(page.locator('.cm-md-heading-2')).toContainText('Still works', {
        timeout: 5000,
      });
    });
  });
});
