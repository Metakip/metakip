import { expect, type Page } from '@playwright/test';

export const API_URL = process.env.API_URL ?? 'http://localhost:3001';
export const WEB_URL = process.env.BASE_URL ?? 'http://localhost:5173';
export const WEB_HOSTNAME = new URL(WEB_URL).hostname;

export async function focusEditor(page: Page): Promise<void> {
  const editor = page.locator('.codemirror-editor .cm-content').first();
  await editor.waitFor({ state: 'visible' });

  // The editor becomes visible before the collaboration provider has applied
  // its initial document. Typing during that window can be overwritten by the
  // initial Yjs sync. Wait for the live status, then ensure the same editable
  // node remains mounted while that sync settles.
  await page.locator('main .bg-emerald-500').first().waitFor({
    state: 'visible',
    timeout: 15_000,
  });

  await expect
    .poll(
      async () => {
        const currentEditor = await editor.elementHandle();
        if (!currentEditor) return false;
        await page.waitForTimeout(750);
        return currentEditor.evaluate(
          (element) =>
            element.isConnected &&
            element.getAttribute('contenteditable') === 'true' &&
            document.querySelector('.codemirror-editor .cm-content') === element,
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  await editor.click();
}

export async function createNewPage(page: Page): Promise<string> {
  await page.goto('/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForURL(/\/$/, { timeout: 15000 });
  await page
    .getByRole('button', { name: /new page/i })
    .first()
    .click();
  await page.waitForSelector('.codemirror-editor .cm-content', { timeout: 15000 });
  return page.url();
}

export async function renamePageViaTitleInput(page: Page, newTitle: string): Promise<void> {
  const titleInput = page.locator('input[data-testid="page-title"]');
  await titleInput.click();
  await titleInput.fill('');
  await titleInput.fill(newTitle);
  await page.keyboard.press('Enter');
  await expect(titleInput).toHaveValue(newTitle, { timeout: 5000 });
}

export async function pasteClipboardText(
  page: Page,
  mimeType: string,
  text: string,
): Promise<void> {
  await pasteClipboardData(page, { [mimeType]: text });
}

export async function pasteClipboardData(
  page: Page,
  values: Record<string, string>,
): Promise<void> {
  await page.locator('.codemirror-editor .cm-content').evaluate((editor, clipboard) => {
    const clipboardData = new DataTransfer();
    for (const [mimeType, text] of Object.entries(clipboard)) {
      clipboardData.setData(mimeType, text);
    }
    editor.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  }, values);
}

export async function selectEditorContents(page: Page): Promise<void> {
  await page.locator('.codemirror-editor .cm-content').click();
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(50);
}

export async function copyEditorText(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const text = await page.locator('.codemirror-editor .cm-content').evaluate(
      (editor) =>
        new Promise<string>((resolve, reject) => {
          const handleCopy = (event: Event) => {
            editor.removeEventListener('copy', handleCopy);
            if (!(event instanceof ClipboardEvent)) {
              reject(new Error('Browser emitted a non-clipboard copy event'));
              return;
            }
            resolve(event.clipboardData?.getData('text/plain') ?? '');
          };

          editor.addEventListener('copy', handleCopy);
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          selection?.removeAllRanges();
          selection?.addRange(range);

          requestAnimationFrame(() => {
            if (!document.execCommand('copy')) {
              editor.removeEventListener('copy', handleCopy);
              reject(new Error('Browser refused to copy editor content'));
            }
          });
        }),
    );
    if (text) return text;
    await page.waitForTimeout(50);
  }
  throw new Error('Editor did not produce plain-text clipboard content');
}
