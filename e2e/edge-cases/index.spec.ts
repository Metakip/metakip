import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test.describe('Edge cases', () => {
  test('rapid typing does not cause hang', async ({ page }) => {
    test.setTimeout(90_000);
    await createNewPage(page);
    await focusEditor(page);
    // Type a long sentence quickly
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
    await page.keyboard.type(text, { delay: 10 });
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText('quick brown fox', {
      timeout: 10_000,
    });
  });

  test('creating h2 after h1 works', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    // Create an h1
    await page.keyboard.type('# Heading');
    await expect(page.locator('.cm-md-heading-1')).toBeVisible({ timeout: 5_000 });
    // Downgrade to h2 by typing ## and pressing Enter
    // First go to the end of the line
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    // Type ## - should make it an h2
    await page.keyboard.type('## Subheading');
    await expect(page.locator('.cm-md-heading-2')).toBeVisible({ timeout: 5_000 });
  });

  test('backtick code block does not cause hang', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await expect(page.locator('.cm-md-code-block')).toBeVisible({ timeout: 5000 });
  });

  test('Enter twice exits a code block', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('```');
    await page.keyboard.press('Enter');
    await page.keyboard.type('const first = 1;');
    await page.keyboard.press('Enter');
    await page.keyboard.type('const second = 2;');
    await page.keyboard.press('Enter');

    const codeBlockLines = page.locator('.cm-md-code-block');
    await expect(codeBlockLines.filter({ hasText: 'const first = 1;' })).toBeVisible();
    await expect(codeBlockLines.filter({ hasText: 'const second = 2;' })).toBeVisible();

    await page.keyboard.press('Enter');
    await page.keyboard.type('Outside the code block');

    await expect(codeBlockLines.filter({ hasText: 'Outside the code block' })).toHaveCount(0);
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText(
      'Outside the code block',
    );
  });
});
