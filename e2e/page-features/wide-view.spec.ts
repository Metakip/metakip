import { expect, type Locator, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

async function expectSideBySide(left: Locator, right: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const [leftBox, rightBox] = await Promise.all([left.boundingBox(), right.boundingBox()]);
      return leftBox && rightBox ? rightBox.x - (leftBox.x + leftBox.width) : -Infinity;
    })
    .toBeGreaterThanOrEqual(-1);
}

test('hides the toggle below the breakpoint and expands the editor on desktop', async ({
  page,
}) => {
  await createNewPage(page);
  await page.setViewportSize({ width: 390, height: 800 });

  const toggle = page.getByRole('button', { name: 'Full width' });
  const editor = page.locator('.page-editor-content');
  await expect(toggle).toBeHidden();
  const mobileWidth = (await editor.boundingBox())?.width ?? 0;
  expect(mobileWidth).toBeGreaterThan(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(toggle).toBeVisible();
  const defaultWidth = (await editor.boundingBox())?.width ?? 0;
  expect(defaultWidth).toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await editor.boundingBox())?.width ?? 0)
    .toBeGreaterThan(defaultWidth + 100);

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(toggle).toBeHidden();
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

  const editor = page.locator('.page-editor-content');
  const rail = page.locator('.inline-comment-card-rail');
  const wrapper = page.locator('.editor-wrapper--with-inline-comment-rail');
  const toggle = page.getByRole('button', { name: 'Full width' });
  await expect(rail.locator('article').first()).toBeVisible();
  await expect(wrapper).toHaveCSS('display', 'grid');
  await expectSideBySide(page.locator('.codemirror-editor'), rail);

  const defaultWidth = (await editor.boundingBox())?.width ?? 0;
  expect(defaultWidth).toBeGreaterThan(1000);
  expect(defaultWidth).toBeLessThanOrEqual(1162);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
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
  await page.getByRole('button', { name: 'Open comments' }).click();

  const editor = page.locator('.page-comments-open > .page-editor-with-comments');
  const panel = page.getByRole('complementary', { name: 'Comments' });
  const toggle = page.getByRole('button', { name: 'Full width' });
  await expect(panel).toBeVisible();
  await expectSideBySide(editor, panel);

  const defaultWidth = (await editor.boundingBox())?.width ?? 0;
  expect(defaultWidth).toBeGreaterThan(700);
  expect(defaultWidth).toBeLessThanOrEqual(801);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await editor.boundingBox())?.width ?? 0)
    .toBeGreaterThan(defaultWidth + 200);
  await expect(panel).toBeVisible();
  await expectSideBySide(editor, panel);
});
