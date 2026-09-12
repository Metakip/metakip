import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test.describe('Markdown formatting shortcuts', () => {
  test('bold via **text**', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('**bold text** ');
    await expect(page.locator('.cm-md-strong')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-strong')).toHaveText('bold text');
  });

  test('italic via *text*', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('*italic text* ');
    await expect(page.locator('.cm-md-emphasis')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-emphasis')).toHaveText('italic text');
  });

  test('strikethrough via ~~text~~', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('~~struck text~~ ');
    await expect(page.locator('.cm-md-strike')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-strike').first()).toHaveText('struck text');
  });

  test('inline code via `code`', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('`inline code` ');
    await expect(page.locator('.cm-md-inline-code')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-inline-code')).toHaveText('inline code');
  });
});

test.describe('Markdown block shortcuts', () => {
  test('bullet list via - ', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('- item');
    await expect(page.locator('.cm-md-list-marker')).toHaveText('•', { timeout: 5_000 });
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText('item');
  });

  test('ordered list via 1. ', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('1. first');
    await expect(page.locator('.cm-md-list-marker')).toHaveText('1.', { timeout: 5_000 });
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText('first');
  });

  test('blockquote via > ', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('> quoted text');
    await expect(page.locator('.cm-md-blockquote')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-blockquote')).toContainText('quoted text');
  });
});
