import { expect, test } from '@playwright/test';
import { createNewPage } from '../fixtures';

test.describe('Stars', () => {
  test('star button is visible on a page', async ({ page }) => {
    await createNewPage(page);

    const starButton = page.getByRole('button', { name: 'Star page' }).first();
    await expect(starButton).toBeVisible({ timeout: 5000 });
  });
});
