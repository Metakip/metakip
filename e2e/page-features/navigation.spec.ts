import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test.describe('Breadcrumbs', () => {
  test('breadcrumb shows workspace name on a page', async ({ page }) => {
    await createNewPage(page);
    const breadcrumb = page.locator('a[href="/"]');
    await expect(breadcrumb).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Table of Contents', () => {
  test('headings are rendered in the editor', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('## Section A');
    await expect(page.locator('.cm-md-heading-2')).toBeVisible({ timeout: 5000 });
  });
});
