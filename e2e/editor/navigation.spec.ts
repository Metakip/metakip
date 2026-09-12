import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test.describe('Navigation between pages', () => {
  test('create two pages and switch between them without hang', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('Page one content');

    // Go back to workspace and create another
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForURL(/\/$/);

    await page
      .getByRole('button', { name: /new page/i })
      .first()
      .click();
    await page.waitForURL(/\/untitled-/);
    await focusEditor(page);
    await page.keyboard.type('Page two content');
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText('Page two content');
  });
});
