import { expect, test } from '@playwright/test';
import { createNewPage, focusEditor, pasteClipboardText } from '../fixtures';

test.describe('Table operations', () => {
  test('inserts rows and columns repeatedly at an empty cell and keeps it editable', async ({
    page,
  }) => {
    await createNewPage(page);
    await focusEditor(page);
    await pasteClipboardText(
      page,
      'text/plain',
      '| A | B | C |\n| :--- | :---: | ---: |\n| Left |  | Right |\n| Next | Middle | End |',
    );
    const table = page.locator('.cm-md-table');
    const headers = table.locator('.cm-md-table-header .cm-md-table-cell');
    const rows = table.locator('.cm-md-table-row');

    await table.locator('.cm-md-table-empty-cell').click();
    await page.getByTitle('Add Column Right', { exact: true }).click();
    await expect(headers).toHaveCount(4);
    await page.getByTitle('Add Column Right', { exact: true }).click();
    await expect(headers).toHaveCount(5);
    await page.keyboard.type('Inserted');
    await expect(rows.first().locator('.cm-md-table-cell').nth(3)).toHaveText('Inserted');
    await expect(rows.first().locator('.cm-md-table-cell').nth(4)).toHaveText('Right');

    await page.getByTitle('Add Row Above', { exact: true }).click();
    await expect(rows).toHaveCount(3);
    await page.getByTitle('Add Row Below', { exact: true }).click();
    await expect(rows).toHaveCount(4);
    await page.getByTitle('Add Row Below', { exact: true }).click();
    await expect(rows).toHaveCount(5);
    await page.keyboard.type('New row');
    await expect(rows.nth(2).locator('.cm-md-table-cell').nth(3)).toHaveText('New row');

    await page.getByTitle('Add Column Left', { exact: true }).click();
    await expect(headers).toHaveCount(6);
    await page.keyboard.type('Left col');
    await expect(rows.nth(2).locator('.cm-md-table-cell').nth(3)).toHaveText('Left col');
    await expect(rows.nth(2).locator('.cm-md-table-cell').nth(4)).toHaveText('New row');

    await headers.first().click();
    await page.getByTitle('Add Row Above', { exact: true }).click();
    await expect(rows.first().locator('.cm-md-table-cell').first()).toHaveText('A');
    await page.keyboard.type('Top');
    await expect(headers.first()).toHaveText('Top');
  });

  test('header and body cells form a continuous grid, including empty columns', async ({
    page,
  }) => {
    await createNewPage(page);
    await focusEditor(page);
    await pasteClipboardText(
      page,
      'text/plain',
      '| Header | Other | Third |\n| --- | :---: | ---: |\n| Left | | Right |',
    );

    const table = page.locator('.cm-md-table');
    await expect(table.locator('.cm-md-table-cell')).toHaveCount(6);
    for (const dark of [false, true]) {
      await page.evaluate(
        (enabled) => document.documentElement.classList.toggle('dark', enabled),
        dark,
      );
      await expect(table.locator('.cm-md-table-separator')).toBeHidden();
      const header = table.locator('.cm-md-table-header .cm-md-table-cell').first();
      const body = table.locator('.cm-md-table-row .cm-md-table-cell').first();
      for (const property of ['font-weight', 'background-color', 'color']) {
        const expected = await body.evaluate(
          (cell, name) => getComputedStyle(cell).getPropertyValue(name),
          property,
        );
        await expect(header).toHaveCSS(property, expected);
      }
      await expect
        .poll(() =>
          table.evaluate((element) => {
            const rows = [...element.querySelectorAll('.cm-md-table-header, .cm-md-table-row')].map(
              (row) =>
                [...row.querySelectorAll('.cm-md-table-cell')].map((cell) =>
                  cell.getBoundingClientRect(),
                ),
            );
            const header = rows[0];
            if (!header || rows.length !== 2) return false;
            return rows.every(
              (row, rowIndex) =>
                row.length === 3 &&
                row.every((cell, index) => {
                  const above = header[index];
                  const previous = row[index - 1];
                  return (
                    above !== undefined &&
                    Math.abs(cell.left - above.left) < 1 &&
                    Math.abs(cell.right - above.right) < 1 &&
                    (!previous || Math.abs(cell.left - previous.right) < 1) &&
                    (rowIndex === 0 || Math.abs(cell.top - above.bottom) < 1)
                  );
                }),
            );
          }),
        )
        .toBe(true);
    }

    await table.locator('.cm-md-table-empty-cell').click();
    await page.keyboard.type('Filled');
    await expect(table.locator('.cm-md-table-row .cm-md-table-cell').nth(1)).toHaveText('Filled');
  });

  test('insert table and add rows', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('a');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Insert Table"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-table')).toBeVisible();

    // Click inside the table to show table manipulation buttons
    await page.locator('.cm-md-table-cell').first().click();

    // Add a row below
    const addRowBtn = page.locator('.floating-toolbar button[title="Add Row Below"]');
    await addRowBtn.waitFor({ state: 'visible', timeout: 3000 });
    const rowCountBefore = await page.locator('.cm-md-table > .cm-line').count();
    await addRowBtn.click();
    const rowCountAfter = await page.locator('.cm-md-table > .cm-line').count();
    expect(rowCountAfter).toBeGreaterThan(rowCountBefore);
  });

  test('delete table from toolbar', async ({ page }) => {
    await createNewPage(page);
    await focusEditor(page);
    await page.keyboard.type('a');
    await page.keyboard.press('Control+a');
    await page.locator('.floating-toolbar button[title="Insert Table"]').click({ timeout: 5000 });
    await expect(page.locator('.cm-md-table')).toBeVisible();

    await page.locator('.cm-md-table-cell').first().click();

    const deleteBtn = page.locator('.floating-toolbar button[title="Delete Table"]');
    await deleteBtn.waitFor({ state: 'visible', timeout: 3000 });
    await deleteBtn.click();
    await expect(page.locator('.cm-md-table')).not.toBeVisible();
  });
});
