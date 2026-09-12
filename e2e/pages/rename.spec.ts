import { expect, test } from '@playwright/test';
import { createNewPage, renamePageViaTitleInput } from '../fixtures';

test.describe('Page renaming', () => {
  test('rename via page title input', async ({ page }) => {
    await createNewPage(page);
    await renamePageViaTitleInput(page, 'My Renamed Page');
    await expect(page.locator('input[data-testid="page-title"]')).toHaveValue('My Renamed Page');
  });

  test('title persists after refresh', async ({ page }) => {
    await createNewPage(page);
    await renamePageViaTitleInput(page, 'Persistent Title');

    await page.reload();
    await expect(page).toHaveURL(/\/[^/]+$/);
    await expect(page.locator('.codemirror-editor .cm-content')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[data-testid="page-title"]')).toHaveValue('Persistent Title');
  });
});
