import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor, renamePageViaTitleInput } from '../fixtures';

test.describe('Data persistence', () => {
  test('content persists after page reload', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('hello world');

    await page.reload();
    await expect(page).toHaveURL(/\/[^/]+$/);
    await expect(page.locator('.codemirror-editor .cm-content')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText('hello world');
  });

  test('title and content both persist after reload', async ({ page }) => {
    await createNewPage(page);
    await renamePageViaTitleInput(page, 'Full Test Page');
    await focusEditor(page);
    await page.keyboard.type('This is some sample content.');

    await page.reload();
    await expect(page).toHaveURL(/\/[^/]+$/);
    await expect(page.locator('.codemirror-editor .cm-content')).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('input[data-testid="page-title"]')).toHaveValue('Full Test Page');
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText(
      'This is some sample content.',
    );
  });

  test('deleted content stays deleted after reload', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('Temporary content');

    // Select all and delete
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');

    await page.reload();
    await expect(page).toHaveURL(/\/[^/]+$/);
    await expect(page.locator('.codemirror-editor .cm-content')).toBeVisible({ timeout: 10_000 });

    // After deleting and reloading, the deleted text should not appear
    await expect(page.locator('.codemirror-editor .cm-content')).not.toContainText(
      'Temporary content',
    );
  });

  test('content survives after closing and reopening the browser tab', async ({
    page,
    context,
  }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('Tab close test');

    // Close the tab and open a new one to the same URL
    const url = page.url();
    await page.close();
    const newPage = await context.newPage();
    await newPage.goto(url);
    await expect(newPage).toHaveURL(/\/[^/]+$/);

    await expect(newPage.locator('.codemirror-editor .cm-content')).toBeVisible({
      timeout: 10_000,
    });
    await expect(newPage.locator('.codemirror-editor .cm-content')).toContainText('Tab close test');
    await newPage.close();
  });
});
