import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test.describe('Dark mode', () => {
  test('editor caret follows text color when switching themes', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('Visible caret');

    const editor = page.locator('.codemirror-editor .cm-editor');
    const content = editor.locator('.cm-content');

    for (const dark of [true, false, true]) {
      await page.evaluate((enabled) => {
        document.documentElement.classList.toggle('dark', enabled);
      }, dark);

      await expect(editor).toHaveClass(/cm-focused/);
      await expect(editor.locator('.cm-content')).toBeFocused();
      await expect(editor.locator('.cm-content')).toHaveCSS('box-shadow', 'none');
      await expect(editor.locator('.cm-content')).toHaveCSS('outline-style', 'none');
      await expect(content).toHaveCSS(
        'caret-color',
        dark ? 'rgb(228, 228, 231)' : 'rgb(39, 39, 42)',
      );
    }

    await page.keyboard.press('Control+a');
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe('Visible caret');
    await expect(editor.locator('.cm-selectionBackground')).toHaveCount(0);
    await expect(editor.locator('.cm-cursorLayer')).toHaveCount(0);
  });

  test('dark mode applies dark class to html', async ({ page }) => {
    await createNewPage(page);

    await page.evaluate(() => localStorage.setItem('metakip-theme', 'dark'));
    await page.reload();
    await expect(page).toHaveURL(/\/[^/]+$/);

    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 10000 });
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  });

  test('light mode removes dark class from html', async ({ page }) => {
    await createNewPage(page);

    await page.evaluate(() => localStorage.setItem('metakip-theme', 'light'));
    await page.reload();
    await expect(page).toHaveURL(/\/[^/]+$/);

    await expect(page.locator('html')).not.toHaveClass(/dark/, { timeout: 10000 });
  });
});
