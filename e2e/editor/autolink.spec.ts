import { expect, test } from '@playwright/test';
import {
  copyEditorText,
  createNewPage,
  focusEditor,
  pasteClipboardData,
  pasteClipboardText,
  selectEditorContents,
} from '../fixtures';

test.describe('Autolink', () => {
  test('external links have an icon, open on click, and expose hover editing', async ({ page }) => {
    const href = 'https://example.com/editor-link-test';
    await page
      .context()
      .route(href, (route) =>
        route.fulfill({ contentType: 'text/html', body: '<h1>External destination</h1>' }),
      );
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type(`Before [External destination](${href}) after`);
    const originalUrl = page.url();
    const link = page.locator(`a.cm-md-link[href="${href}"]`);
    await expect(link).toBeVisible();
    const icon = await link.evaluate((element) => getComputedStyle(element, '::after').maskImage);
    expect(icon).toContain('data:image/svg+xml');
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(href);
    await expect(page).toHaveURL(originalUrl);
    await popup.close();
    await expect(link).toBeVisible();
    await link.hover();
    await page.locator('.link-hover-tooltip-edit').click();
    await expect(page.locator('.link-editor-input-url')).toHaveValue(href);
  });

  test('editing links colors only the URL blue in both themes', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type(
      '[Editing](https://example.com/edit) and [Preview](https://example.com/preview)',
    );
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');

    const source = page
      .locator('.cm-md-link-source')
      .filter({ hasText: 'https://example.com/edit' });
    const preview = page.locator('a.cm-md-link[href="https://example.com/preview"]');
    const label = page.locator('.cm-content').getByText('Editing', { exact: true });
    await expect(source).toBeVisible();
    await expect(preview).toBeVisible();

    for (const dark of [true, false]) {
      await page.evaluate((enabled) => {
        document.documentElement.classList.toggle('dark', enabled);
      }, dark);
      const color = dark ? 'rgb(96, 165, 250)' : 'rgb(37, 99, 235)';
      await expect(source).toHaveCSS('color', color);
      await expect(preview).toHaveCSS('color', color);
      await expect(label).toHaveCSS('color', dark ? 'rgb(228, 228, 231)' : 'rgb(39, 39, 42)');
    }
  });

  test('links a typed URL and preserves following text', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const url = 'https://github.com/Metakip/metakip/issues/104';

    await page.keyboard.type(`${url} next`);

    await expect(page.locator(`.codemirror-editor a[href="${url}"]`)).toHaveText(url);
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText(`${url} next`);
  });

  test('links a typed URL without its terminal punctuation', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const url = 'https://example.com/punctuation';

    await page.keyboard.type(`${url}. `);

    await expect(page.locator(`.codemirror-editor a[href="${url}"]`)).toHaveText(url);
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText(`${url}.`);
  });

  test('does not link a typed URL embedded in a malformed token prefix', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);

    await page.keyboard.type('abchttps://example.com ');

    await expect(page.locator('.codemirror-editor a')).toHaveCount(0);
  });

  test('links only the token before the typed delimiter', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const url = 'example.com/before-existing-text';
    const href = `https://${url}`;
    await page.keyboard.type('existing text');
    await page.keyboard.press('Home');
    await page.keyboard.type(`${url} `);

    await expect(page.locator(`.codemirror-editor a[href="${href}"]`)).toHaveText(url);
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText(
      `${url} existing text`,
    );
  });

  test('links a direct URL pasted at a collapsed cursor, including Markdown-like URLs', async ({
    page,
  }) => {
    await createNewPage(page);
    await focusEditor(page);
    const url = 'https://example.com/$foo$';

    await pasteClipboardText(page, 'text/plain', url);

    await expect(page.locator(`.codemirror-editor a[href="${url}"]`)).toHaveText(url);
  });

  test('continues editing after one Enter following a pasted URL', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await pasteClipboardText(page, 'text/plain', 'https://example.com');
    await page.keyboard.press('Enter');
    await page.keyboard.type('next paragraph');

    await expect(page.locator('.cm-content')).toContainText('next paragraph');
  });

  test('links a typed URL before splitting its paragraph with Enter', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const url = 'https://example.com/typed-enter';
    await page.keyboard.type(url);
    await page.keyboard.press('Enter');
    await page.keyboard.type('next paragraph');

    await expect(page.locator(`.codemirror-editor a[href="${url}"]`)).toHaveText(url);
    await expect(page.locator('.cm-content')).toContainText('next paragraph');
  });

  test('links a typed URL before Enter creates the next list item', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const url = 'https://example.com/list-item';
    await page.keyboard.type(`- ${url}`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('next item');

    await expect(page.locator(`.codemirror-editor a[href="${url}"]`)).toHaveText(url);
    await expect(page.locator('.cm-md-list-marker')).toHaveText(['•', '•']);
    await expect(page.locator('.codemirror-editor .cm-content')).toContainText('next item');
  });

  test('links selected text from plain text or a URI-list destination', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const label = 'selected label';
    const url = 'https://example.com/uri-list-destination';
    await page.keyboard.type(label);
    await selectEditorContents(page);
    await pasteClipboardData(page, { 'text/plain': 'Clipboard label', 'text/uri-list': url });

    await expect(page.locator(`.codemirror-editor a[href="${url}"]`)).toHaveText(label);
  });

  test('normalizes a bare URI-list host before linking selected text', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const label = 'selected label';
    await page.keyboard.type(label);
    await selectEditorContents(page);

    await pasteClipboardText(page, 'text/uri-list', 'example.com');

    await expect(page.locator('.codemirror-editor a[href="https://example.com"]')).toHaveText(
      label,
    );
  });

  test('inserts a URI-list-only URL as a link at a collapsed cursor', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const url = 'https://example.com/uri-list-only';

    await pasteClipboardText(page, 'text/uri-list', url);

    await expect(page.locator(`.codemirror-editor a[href="${url}"]`)).toHaveText(url);
  });

  test('preserves structure and formatting when pasting mixed content', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const text = 'First https://example.com/path.\n\nThen example.org/docs.';

    await pasteClipboardText(page, 'text/plain', text);

    await expect(page.locator('.codemirror-editor a')).toHaveCount(2);
    await expect(page.locator('.codemirror-editor a').nth(1)).toHaveAttribute(
      'href',
      'https://example.org/docs',
    );
  });

  test('preserves copied URL paragraph boundaries', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const urls = ['https://x.com/home', 'https://github.com/Metakip/metakip/pull/112'];
    await pasteClipboardText(page, 'text/plain', urls[0] ?? '');
    await page.keyboard.press('Enter');
    await pasteClipboardText(page, 'text/plain', urls[1] ?? '');

    await expect.poll(() => copyEditorText(page)).toBe(urls.join('\n\n'));
  });

  test('supports commented and multi-entry URI lists', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const urls = ['https://example.com/first', 'https://example.com/second'];
    await pasteClipboardData(page, {
      'text/plain': '# Markdown-looking clipboard label',
      'text/uri-list': `# browser clipboard\r\n${urls.join('\r\n')}`,
    });

    await expect(page.locator('.codemirror-editor a')).toHaveCount(2);
  });

  test('preserves every URI-list URL when plain text contains only the first URL', async ({
    page,
  }) => {
    await createNewPage(page);
    await focusEditor(page);
    const urls = ['https://example.com/first', 'https://example.com/second'];

    await pasteClipboardData(page, {
      'text/plain': urls[0] ?? '',
      'text/uri-list': urls.join('\r\n'),
    });

    await expect(page.locator('.codemirror-editor a')).toHaveCount(2);
  });

  test('replaces a selection with every URI-list URL when plain text has only the first URL', async ({
    page,
  }) => {
    await createNewPage(page);
    await focusEditor(page);
    const urls = ['https://example.com/first', 'https://example.com/second'];
    await page.keyboard.type('selected label');
    await selectEditorContents(page);

    await pasteClipboardData(page, {
      'text/plain': urls[0] ?? '',
      'text/uri-list': urls.join('\r\n'),
    });

    await expect(page.locator('.codemirror-editor a')).toHaveCount(2);
  });

  test('does not link a URL pasted over a selection spanning inline code', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    const url = 'https://example.com/plain-selection';
    await page.keyboard.type('plain `code`');
    await selectEditorContents(page);

    await pasteClipboardText(page, 'text/plain', url);

    await expect(page.locator('.codemirror-editor .cm-content')).toHaveText(url);
    await expect(page.locator('.codemirror-editor a')).toHaveCount(0);
  });

  test('rejects invalid direct URLs', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('192.168.1.1 foo.invalidtld ');
    await pasteClipboardText(page, 'text/plain', '192.168.1.1');
    await page.keyboard.type(' ');
    await expect(page.locator('.codemirror-editor a')).toHaveCount(0);
  });

  test('pastes a direct URL as plain text at an inline-code cursor', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('`seed`');
    await page.keyboard.press('ArrowLeft');
    await pasteClipboardText(page, 'text/plain', 'https://example.com/code');
    await expect(page.locator('.cm-md-inline-code')).toContainText('https://example.com/code');
    await expect(page.locator('.cm-md-inline-code a')).toHaveCount(0);
  });

  test('pastes a direct URL as plain text with an inline-code stored mark', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.press('Control+e');

    await pasteClipboardText(page, 'text/plain', 'https://example.com/stored-code');

    await expect(page.locator('.cm-md-inline-code')).toContainText(
      'https://example.com/stored-code',
    );
    await expect(page.locator('.cm-md-inline-code a')).toHaveCount(0);
  });
});
