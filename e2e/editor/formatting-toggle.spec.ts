import { expect, test } from '@playwright/test';
import { copyEditorText, createNewPage, focusEditor } from '../fixtures';

test('inline code matches fenced code colors and typography in both themes', async ({ page }) => {
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('Inline `value`');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');
  await page.keyboard.press('Enter');
  await page.keyboard.type('block value');
  await page.keyboard.press('Control+Enter');
  const inline = page.locator('.cm-md-inline-code');
  const block = page.locator('.cm-md-code-block').filter({ hasText: 'block value' });
  for (const dark of [false, true]) {
    await page.evaluate(
      (enabled) => document.documentElement.classList.toggle('dark', enabled),
      dark,
    );
    for (const property of ['background-color', 'color', 'font-family', 'font-size']) {
      const expected = await block.evaluate(
        (element, name) => getComputedStyle(element).getPropertyValue(name),
        property,
      );
      await expect(inline).toHaveCSS(property, expected);
    }
  }
});

test('typing a fence above existing text never pulls that text into code', async ({ page }) => {
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('Existing paragraph');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# Existing heading');
  await page.keyboard.press('Enter');
  await page.keyboard.type('More text');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('```');

  // Assert before pressing Enter: the opening fence must already be paired.
  await expect(page.locator('.cm-md-code-block')).toHaveCount(2);
  await expect(page.locator('.cm-md-heading-1')).toContainText('Existing heading');
  const existing = page.locator('.cm-content > .cm-line').filter({ hasText: 'Existing paragraph' });
  await expect(existing).not.toHaveClass(/cm-md-code-block/);
  await page.keyboard.type('js');
  await page.keyboard.press('Enter');
  await page.keyboard.type('new code');
  await expect(page.locator('.cm-md-code-block')).toHaveCount(3);
  await expect(existing).not.toHaveClass(/cm-md-code-block/);
  await expect(page.locator('.cm-md-heading-1')).toContainText('Existing heading');
});

for (const format of [
  { title: 'Bold (Ctrl+B)', shortcut: 'Control+b', selector: '.cm-md-strong' },
  { title: 'Italic (Ctrl+I)', shortcut: 'Control+i', selector: '.cm-md-emphasis' },
  { title: 'Strikethrough', shortcut: 'Control+Shift+x', selector: '.cm-md-strike' },
]) {
  test(`${format.title} handles selection whitespace, repeated toggles, and subsequent typing`, async ({
    page,
  }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type(' hello ');
    await page.keyboard.press('Control+a');
    await page.getByTitle(format.title, { exact: true }).click();
    await expect(page.locator(format.selector)).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.press(format.shortcut);
    await expect(page.locator(format.selector)).toHaveCount(0);
    await expect(page.locator('.cm-content')).toHaveText('hello');

    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.press(format.shortcut);
    await page.keyboard.type('word');
    await page.keyboard.press(format.shortcut);
    await page.keyboard.type(' plain');
    await expect(page.locator(format.selector)).toHaveText('word');
    await expect(page.locator('.cm-content')).toHaveText('word plain');

    await page.keyboard.press('Control+a');
    await page.keyboard.type('formatted paragraph');
    await page.keyboard.press('Control+a');
    await page.getByTitle(format.title, { exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.keyboard.type('next paragraph');
    await expect(page.locator(format.selector)).toHaveText('formatted paragraph');
    await expect(page.locator('.cm-content > .cm-line').last()).toHaveText('next paragraph');
  });
}

test('bold and italic shortcuts combine and toggle independently', async ({ page }) => {
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('hello');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+i');
  await expect(page.locator('.cm-md-strong')).toBeVisible();
  await expect(page.locator('.cm-md-emphasis')).toBeVisible();
  await page.keyboard.press('Control+i');
  await expect(page.locator('.cm-md-emphasis')).toHaveCount(0);
  await expect(page.locator('.cm-md-strong')).toBeVisible();
  await page.keyboard.press('Control+b');
  await expect(page.locator('.cm-md-strong')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveText('hello');
});

for (const exitMethod of [
  { name: 'Ctrl+I', key: 'Control+i' },
  { name: 'ArrowRight', key: 'ArrowRight' },
]) {
  test(`${exitMethod.name} exits italic formatting before the next character`, async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.press('Control+i');
    await page.keyboard.type('my name is atharva');
    await page.keyboard.press(exitMethod.key);
    await page.keyboard.type('X');

    await expect.poll(() => copyEditorText(page)).toBe('*my name is atharva*X');
  });

  test(`${exitMethod.name} moves trailing whitespace outside italic formatting`, async ({
    page,
  }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.press('Control+i');
    await page.keyboard.type('my name is atharva ');
    await page.keyboard.press(exitMethod.key);
    await page.keyboard.type('X');

    await expect.poll(() => copyEditorText(page)).toBe('*my name is atharva* X');
  });
}

test('blockquote continues once and exits on an empty quoted line', async ({ page }) => {
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.press('Control+Shift+b');
  await page.keyboard.type('quoted');
  await page.keyboard.press('Enter');
  await page.keyboard.type('continued');
  await expect(page.locator('.cm-md-blockquote')).toHaveCount(2);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('outside');
  const lastLine = page.locator('.cm-content > .cm-line').last();
  await expect(lastLine).toHaveText('outside');
  await expect(lastLine).not.toHaveClass(/cm-md-blockquote/);
});

test('code fences close, allow typing, exit, and toggle back to paragraphs', async ({ page }) => {
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('```js');
  await page.keyboard.press('Enter');
  await page.keyboard.type('const x = 1;');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('outside');
  const lastLine = page.locator('.cm-content > .cm-line').last();
  await expect(lastLine).toHaveText('outside');
  await expect(lastLine).not.toHaveClass(/cm-md-code-block/);
  await page.locator('.cm-md-code-block').filter({ hasText: 'const x = 1;' }).click();
  await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('.cm-md-code-block')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('const x = 1;');
  await expect(page.locator('.cm-content')).toContainText('outside');
});

test('slash code-block command creates a block rather than an empty inline span', async ({
  page,
}) => {
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('/codeblock');
  await expect(page.getByTestId('slash-menu')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-md-code-block')).toHaveCount(3);
  await page.keyboard.type('code content');
  await expect(page.locator('.cm-md-code-block').filter({ hasText: 'code content' })).toBeVisible();
  await expect(page.locator('.cm-md-inline-code')).toHaveCount(0);
});

test('code blocks retain indentation, allow blank lines, and exit explicitly', async ({ page }) => {
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('```js');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('first();');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second();');
  const codeLines = page.locator('.cm-md-code-block');
  await expect(codeLines).toHaveCount(5);
  await expect(codeLines.filter({ hasText: 'first();' })).toHaveText(/^ {2}first\(\);$/);
  await expect(codeLines.filter({ hasText: 'second();' })).toHaveText(/^ {2}second\(\);$/);
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('outside');
  await expect(page.locator('.cm-content > .cm-line').last()).toHaveText('outside');
  await expect(page.locator('.cm-content > .cm-line').last()).not.toHaveClass(/cm-md-code-block/);
});

test('pasting tables and fences into a code block keeps them literal', async ({ page }) => {
  await createNewPage(page);
  await focusEditor(page);
  await page.keyboard.type('```md');
  await page.keyboard.press('Enter');
  const pasted = 'a\tb\n1\t2\n```\n**literal**';
  await page.locator('.cm-content').evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }),
    );
  }, pasted);
  await expect(page.locator('.cm-md-table')).toHaveCount(0);
  await expect(page.locator('.cm-md-strong')).toHaveCount(0);
  await expect(page.locator('.cm-md-code-block').filter({ hasText: '**literal**' })).toBeVisible();
});
