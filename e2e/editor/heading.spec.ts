import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test.describe('Headings: markdown shortcuts', () => {
  test('preview heading text aligns with the paragraph text', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('##   Aligned heading\n\nParagraph');

    const heading = page.locator('.cm-md-heading-2');
    await expect(heading).toHaveText('Aligned heading');
    await expect
      .poll(() =>
        heading.evaluate((element) => {
          const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
          if (!text) return false;
          const range = document.createRange();
          range.selectNodeContents(text);
          return (
            Math.abs(range.getBoundingClientRect().left - element.getBoundingClientRect().left) < 1
          );
        }),
      )
      .toBe(true);
  });

  test('headings are not underlined in preview or while editing', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type(
      Array.from({ length: 6 }, (_, index) => `${'#'.repeat(index + 1)} Heading ${index + 1}`).join(
        '\n',
      ),
    );

    const headings = page.locator('.cm-md-heading');
    await expect(headings).toHaveCount(6);
    await expect
      .poll(() =>
        headings.evaluateAll((elements) =>
          elements.every((element) =>
            [element, ...element.querySelectorAll('*')].every(
              (node) => !getComputedStyle(node).textDecorationLine.includes('underline'),
            ),
          ),
        ),
      )
      .toBe(true);
  });

  test('h1 via # + space', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('# Heading 1');
    await expect(page.locator('.cm-md-heading-1')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-heading-1')).toContainText('Heading 1');
  });

  test('h2 via ## + space', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('## Heading 2');
    await expect(page.locator('.cm-md-heading-2')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-heading-2')).toContainText('Heading 2');
  });

  test('h3 via ### + space', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('### Heading 3');
    await expect(page.locator('.cm-md-heading-3')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-heading-3')).toContainText('Heading 3');
  });

  test('h4 through h6 via #### to ###### + space', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);

    await page.keyboard.type('#### Heading 4');
    await expect(page.locator('.cm-md-heading-4')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-heading-4')).toContainText('Heading 4');

    await page.keyboard.press('Enter');
    await page.keyboard.type('##### Heading 5');
    await expect(page.locator('.cm-md-heading-5')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-heading-5')).toContainText('Heading 5');

    await page.keyboard.press('Enter');
    await page.keyboard.type('###### Heading 6');
    await expect(page.locator('.cm-md-heading-6')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-md-heading-6')).toContainText('Heading 6');
  });

  test('empty heading does not hang the page', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    // Type # + space with no text after it
    await page.keyboard.type('# ');
    await page.locator('.cm-md-heading-1').waitFor({ state: 'visible', timeout: 5000 });
    await expect(page.locator('.cm-md-heading-1')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Headings: toolbar buttons', () => {
  test('floating toolbar appears on text selection', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Control+a');
    const toolbar = page.locator('.floating-toolbar').first();
    await expect(toolbar).toBeVisible({ timeout: 5000 });
  });
});
