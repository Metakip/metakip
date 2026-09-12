import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor, pasteClipboardText } from '../fixtures';

test('link popover edits and removes links while Markdown editing remains available', async ({
  page,
}) => {
  await createNewPage(page);
  await focusEditor(page);
  await pasteClipboardText(page, 'text/plain', 'Before [**Label**](https://example.com/old) after');
  await page.locator('a.cm-md-link').hover();
  await page
    .locator('.link-hover-tooltip')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const popup = page.locator('.link-editor-popup');
  await expect(popup.locator('.link-editor-input-text')).toHaveValue('Label');
  await popup.locator('.link-editor-input-url').fill('https://example.com/new');
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  const link = page.locator('a.cm-md-link[href="https://example.com/new"]');
  await expect(link.locator('.cm-md-strong')).toHaveText('Label');
  await page.keyboard.press('Control+Home');
  for (let index = 0; index < 8; index++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.cm-content')).toContainText('[**Label**](https://example.com/new)');
  await page.keyboard.press('Control+End');
  await link.hover();
  await page
    .locator('.link-hover-tooltip')
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await expect(page.locator('a.cm-md-link')).toHaveCount(0);
  await expect(page.locator('.cm-md-strong')).toHaveText('Label');
});

test('the link shortcut retains the existing URL prompt', async ({ page }) => {
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('A label');
  await page.keyboard.press('Control+a');
  page.once('dialog', (dialog) => dialog.accept('example.com'));
  await page.keyboard.press('Control+k');
  await expect(page.locator('a.cm-md-link[href="https://example.com"]')).toHaveText('A label');
});

test('equations have visual editors and still support direct Markdown editing', async ({
  page,
}) => {
  await createNewPage(page);
  await focusEditor(page);
  await pasteClipboardText(page, 'text/plain', 'Before $x^2$ after\n\n$$\nx^2\n$$\nAfter');
  await page.locator('.cm-md-math').first().click();
  const inline = page.locator('.math-editor-popup');
  await inline.locator('textarea').fill('x^3 + 1');
  await inline.getByRole('button', { name: 'Done', exact: true }).click();
  await page.keyboard.press('Control+Home');
  for (let index = 0; index < 8; index++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.cm-content')).toContainText('$x^3 + 1$');
  await page.keyboard.press('Control+End');
  await page.locator('.cm-md-math-block').click();
  const block = page.locator('.math-editor-popup');
  await expect(block.locator('.math-editor-header')).toHaveText('Edit Block Equation');
  await block.locator('textarea').fill('x = 1\ny = 2');
  await block.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.cm-md-math-block')).toBeVisible();
  await expect(page.locator('.cm-content > .cm-line').last()).toHaveText('After');
});
