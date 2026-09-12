import { expect, test } from '@playwright/test';
import { createNewPage } from '../fixtures';

test.describe('Command palette', () => {
  test('quick action "New Page" creates a page', async ({ page }) => {
    await createNewPage(page);

    await page.keyboard.press('Control+K');
    await expect(page.getByPlaceholder('Search pages...')).toBeVisible({ timeout: 5000 });

    const newPageAction = page.getByText('New Page').first();
    await expect(newPageAction).toBeVisible({ timeout: 5000 });
    await newPageAction.click();

    await page.waitForURL(/\/untitled-/);
    await expect(page.locator('.codemirror-editor .cm-content')).toBeVisible({ timeout: 10000 });
  });

  test('quick action "Go to Trash" navigates to trash', async ({ page }) => {
    await createNewPage(page);

    await page.keyboard.press('Control+K');
    await expect(page.getByPlaceholder('Search pages...')).toBeVisible({ timeout: 5000 });

    const goToTrash = page.getByText('Go to Trash');
    await expect(goToTrash).toBeVisible({ timeout: 5000 });
    await goToTrash.click();

    await expect(page).toHaveURL(/\/trash$/);
  });
});
