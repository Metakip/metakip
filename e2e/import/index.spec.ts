import { expect, test } from '@playwright/test';

test.describe('Markdown import', () => {
  test('import markdown file via sidebar', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForURL(/\/$/, { timeout: 15000 });

    const importLabel = page.locator('label[title="Import markdown file"]');
    await expect(importLabel).toBeVisible({ timeout: 5000 });

    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      importLabel.click(),
    ]);

    await fileChooser.setFiles({
      name: 'test-import.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Imported Title\n\nHello from imported file.'),
    });

    await expect(page.locator('.codemirror-editor .cm-content')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[data-testid="page-title"]')).toHaveValue('Imported Title');
  });
});
