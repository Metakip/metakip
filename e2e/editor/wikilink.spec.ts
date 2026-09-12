import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor, renamePageViaTitleInput } from '../fixtures';

test.describe('Wikilinks', () => {
  test('plain clicks navigate to a page without a hover editor', async ({ page }) => {
    const targetUrl = await createNewPage(page);
    const targetId = targetUrl.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
    expect(targetId).toBeTruthy();
    const title = `Link target ${Date.now()}`;
    await renamePageViaTitleInput(page, title);
    await focusEditor(page);
    await page.keyboard.type('## Details');

    await createNewPage(page);
    await focusEditor(page);
    const source = `[[${title}#Details | Open target]]`;
    await page.keyboard.type(`Before ${source} after`);
    const link = page.locator('.cm-md-wiki-link[role="link"]');
    await expect(link).toHaveText('Open target');
    expect(await link.evaluate((element) => getComputedStyle(element, '::after').maskImage)).toBe(
      'none',
    );
    await link.hover();
    await expect(page.locator('.link-hover-tooltip, .link-editor-popup')).toHaveCount(0);
    await link.click();
    await expect.poll(() => page.url()).toContain(targetId);
    await expect(page.locator('input[data-testid="page-title"]')).toHaveValue(title);
  });

  test('[[ triggers suggestions popup', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);

    // Type [[ to trigger the wiki link suggestion engine
    await page.keyboard.type('[[');

    // The suggestions popup renders inside editor-wrapper when open
    const popup = page.getByTestId('wikilink-suggestions');
    await popup.waitFor({ state: 'visible', timeout: 5000 });
    await expect(popup).toBeVisible();
  });
});
