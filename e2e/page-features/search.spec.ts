import { expect, test } from '@playwright/test';
import { createNewPage } from '../fixtures';

test.describe('Search', () => {
  test('open search dialog via keyboard shortcut', async ({ page }) => {
    await createNewPage(page);

    await page.keyboard.press('Control+K');
    const searchInput = page.getByRole('combobox', { name: 'Search pages and folders' });
    await expect(searchInput).toBeVisible({ timeout: 5000 });
  });

  test('show empty state when no results', async ({ page }) => {
    await createNewPage(page);

    await page.keyboard.press('Control+K');
    const searchInput = page.getByRole('combobox', { name: 'Search pages and folders' });
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill('zzzznonexistent');
    await expect(page.getByText('No results found')).toBeVisible({ timeout: 5000 });
  });
});
