import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor } from '../fixtures';

test.describe('Floating toolbar buttons', () => {
  test('inline formatting buttons produce correct markup', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);

    // Bold
    await page.keyboard.type('bold text');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Bold (Ctrl+B)"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-strong')).toBeVisible();
    // Move past bold text
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    // Italic
    await page.keyboard.type('italic text');
    await page.keyboard.press('Control+a');
    await page
      .locator('.floating-toolbar button[title="Italic (Ctrl+I)"]')
      .click({ timeout: 5000 });
    await expect(page.locator('.cm-md-emphasis')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    // Strikethrough
    await page.keyboard.type('struck text');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Strikethrough"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-strike')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    // Inline code
    await page.keyboard.type('code');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Code"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-inline-code')).toBeVisible();
  });

  test('heading buttons produce h1-h3', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);

    // H1
    await page.keyboard.type('Heading 1');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Heading 1"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-heading-1')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    // H2
    await page.keyboard.type('Heading 2');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Heading 2"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-heading-2')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    // H3
    await page.keyboard.type('Heading 3');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Heading 3"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-heading-3')).toBeVisible();
  });

  test('list buttons produce correct list types', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);

    // Bullet list
    await page.keyboard.type('Bullet');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Bullet List"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-list-marker')).toHaveText('•', { timeout: 5000 });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    // Ordered list
    await page.keyboard.type('First');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Ordered List"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-list-marker').last()).toHaveText('1.', { timeout: 5000 });
  });

  test('task list via toolbar', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('Task');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Task List"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-task-checkbox')).toBeVisible({ timeout: 5000 });
  });

  test('toggles off list formatting when toolbar button clicked again', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);

    await page.keyboard.type('Bullet');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Bullet List"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-list-marker')).toHaveText('•', { timeout: 5000 });
    await page.locator('.floating-toolbar button[title="Bullet List"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-list-marker')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    await page.keyboard.type('Ordered');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Ordered List"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-list-marker')).toHaveText('1.', { timeout: 5000 });
    // Re-select before toggling off to ensure the toolbar reappears
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.locator('.floating-toolbar button[title="Ordered List"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-list-marker')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    await page.keyboard.type('Task');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Task List"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-task-checkbox').first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.locator('.floating-toolbar button[title="Task List"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-task-checkbox')).toHaveCount(0);
  });

  test('highlights correct toolbar icon for active list type', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);

    const bulletBtn = page.locator('.floating-toolbar button[title="Bullet List"]');
    const orderedBtn = page.locator('.floating-toolbar button[title="Ordered List"]');
    const taskBtn = page.locator('.floating-toolbar button[title="Task List"]');

    await page.keyboard.type('Task item');
    await page.keyboard.press('Control+a');
    await taskBtn.click({ timeout: 5000 });
    await expect(page.locator('.cm-md-task-checkbox').first()).toBeVisible({ timeout: 5000 });
    await expect(taskBtn).toHaveClass(/bg-zinc-600/);
    await expect(bulletBtn).not.toHaveClass(/bg-zinc-600/);
    await expect(orderedBtn).not.toHaveClass(/bg-zinc-600/);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    // Select all text before toggling off
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(100);
    await taskBtn.click({ timeout: 5000 });
    await expect(page.locator('.cm-md-task-checkbox')).toHaveCount(0);

    // Workaround: directly evaluate to set selection and click toolbar
    await page.keyboard.type('Bullet item');
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(100);
    await bulletBtn.click({ timeout: 5000 });
    await expect(page.locator('.cm-md-list-marker').first()).toHaveText('•', { timeout: 5000 });
    await expect(bulletBtn).toHaveClass(/bg-zinc-600/);
    await expect(taskBtn).not.toHaveClass(/bg-zinc-600/);
    await expect(orderedBtn).not.toHaveClass(/bg-zinc-600/);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    // Select all before toggling off
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(100);
    await bulletBtn.click({ timeout: 5000 });
    await expect(page.locator('.cm-md-list-marker')).toHaveCount(0);

    await page.keyboard.type('Ordered item');
    await page.keyboard.press('Control+a');
    await orderedBtn.click({ timeout: 5000 });
    await expect(page.locator('.cm-md-list-marker')).toHaveText('1.', { timeout: 5000 });
    await expect(orderedBtn).toHaveClass(/bg-zinc-600/);
    await expect(bulletBtn).not.toHaveClass(/bg-zinc-600/);
    await expect(taskBtn).not.toHaveClass(/bg-zinc-600/);
  });

  test('insert table via toolbar', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('a');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Insert Table"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-table')).toBeVisible();
  });
});
