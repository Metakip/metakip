import { expect, type Locator, type Page, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

async function expectSideBySide(left: Locator, right: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const [leftBox, rightBox] = await Promise.all([left.boundingBox(), right.boundingBox()]);
      return leftBox && rightBox ? rightBox.x - (leftBox.x + leftBox.width) : -Infinity;
    })
    .toBeGreaterThanOrEqual(-1);
}

async function enableWideView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Full width', exact: true }).click();
}

test('expands the editor on desktop without changing its width on mobile', async ({ page }) => {
  await createNewPage(page);
  await page.setViewportSize({ width: 390, height: 800 });

  const editor = page.getByTestId('page-editor-content');
  const mobileWidth = (await editor.boundingBox())?.width ?? 0;
  expect(mobileWidth).toBeGreaterThan(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  const defaultWidth = (await editor.boundingBox())?.width ?? 0;
  expect(defaultWidth).toBeGreaterThan(0);

  await enableWideView(page);
  await expect
    .poll(async () => (await editor.boundingBox())?.width ?? 0)
    .toBeGreaterThan(defaultWidth + 100);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect
    .poll(async () => (await editor.boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(mobileWidth + 2);
});

test('keeps an inline comment rail beside the editor in both width modes', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('A comment anchor for the width layout');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Add comment to selection' }).click();

  const composer = page.getByRole('dialog', { name: 'Add comment to selection' });
  await composer.getByRole('textbox', { name: 'New comment on selection' }).fill('Width test');
  await composer.getByRole('button', { name: 'Comment', exact: true }).click();

  const editor = page.getByTestId('page-editor-content');
  const rail = page.locator('.inline-comment-card-rail');
  const wrapper = page.locator('.editor-wrapper--with-inline-comment-rail');
  await expect(rail.locator('article').first()).toBeVisible();
  await expect(wrapper).toHaveCSS('display', 'grid');
  await expectSideBySide(page.locator('.codemirror-editor'), rail);

  const defaultWidth = (await editor.boundingBox())?.width ?? 0;
  expect(defaultWidth).toBeGreaterThan(1000);
  expect(defaultWidth).toBeLessThanOrEqual(1162);
  await enableWideView(page);
  await expect
    .poll(async () => (await editor.boundingBox())?.width ?? 0)
    .toBeGreaterThan(defaultWidth + 200);
  await expect(rail.locator('article').first()).toBeVisible();
  await expect(wrapper).toHaveCSS('display', 'grid');
  await expectSideBySide(page.locator('.codemirror-editor'), rail);
});

test('expands the editor beside a docked comments panel without overlap', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('# Docked comments');
  const outline = page.getByRole('region', { name: 'Table of contents' });
  await expect(outline).toBeVisible();

  await page.getByRole('button', { name: 'Open comments' }).click();

  const editor = page.getByTestId('page-editor-content');
  const panel = page.getByRole('complementary', { name: 'Comments' });
  await expect(panel).toBeVisible();
  await expect(outline).toHaveCount(0);
  await expectSideBySide(editor, panel);

  const defaultWidth = (await editor.boundingBox())?.width ?? 0;
  expect(defaultWidth).toBeGreaterThan(700);
  expect(defaultWidth).toBeLessThanOrEqual(801);
  await enableWideView(page);
  await expect
    .poll(async () => (await editor.boundingBox())?.width ?? 0)
    .toBeGreaterThan(defaultWidth + 200);
  await expect(panel).toBeVisible();
  await expectSideBySide(editor, panel);

  await panel.getByRole('button', { name: 'Close comments' }).click();
  await expect(outline).toBeVisible();
});
