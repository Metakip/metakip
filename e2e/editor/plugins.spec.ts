import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test.describe('Editor plugins', () => {
  test('callout block via > [!note]', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('> [!note] Callout text');
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText('Callout text');
  });

  test('inline math via $...$ renders', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('$E=mc^2$ ');
    // Math should render as KaTeX — check for katex elements or math spans
    const mathEl = page.locator('.codemirror-editor .katex').first();
    await mathEl.waitFor({ state: 'visible', timeout: 5000 });
    await expect(mathEl).toBeVisible({ timeout: 5000 });
  });

  test('inline tag via #tag renders', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type(' #mytag ');
    // Tag should render as a tag node — check for span with class "tag"
    const tagEl = page.locator('.cm-md-tag').first();
    await expect(tagEl).toBeVisible({ timeout: 5000 });
  });
});
