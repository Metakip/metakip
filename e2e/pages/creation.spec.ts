import { expect, test } from '@playwright/test';

test.describe('Page creation', () => {
  test('create page via workspace home "New Page" button', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/$/);

    await page
      .getByRole('button', { name: /new page/i })
      .first()
      .click();
    await page.waitForURL(/\/untitled-/);

    // A new page should have an empty editor
    await expect(page.locator('.codemirror-editor .cm-content')).toBeVisible();
    // The editor should contain a paragraph with a trailing break (empty state)
    await expect(page.locator('.codemirror-editor .cm-line')).toBeVisible();
  });

  test('create page via sidebar "Create note" button', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/$/);

    // Count existing sidebar pages
    const beforeCount = await page.locator('text=Untitled').count();
    await page.getByRole('button', { name: /create note/i }).click();
    // A new "Untitled" page should appear
    await page
      .locator('text=Untitled')
      .nth(beforeCount)
      .waitFor({ state: 'visible', timeout: 5000 });
    const afterCount = await page.locator('text=Untitled').count();
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  test('new page has "Untitled" as default title', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/$/);

    await page
      .getByRole('button', { name: /new page/i })
      .first()
      .click();
    await page.waitForURL(/\/untitled-/);

    await expect(page.locator('input[data-testid="page-title"]')).toHaveValue('Untitled');
  });
});
