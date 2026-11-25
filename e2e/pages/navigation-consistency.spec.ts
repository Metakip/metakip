import { expect, type Page, test } from '@playwright/test';
import { waitForLiveCollaboration } from '../fixtures';

type EntityType = 'page' | 'folder';

function entitySelector(type: EntityType, id: string): string {
  return `[data-entity-type="${type}"][data-entity-id="${id}"]`;
}

const treeRoutePattern = /\/api\/(pages|folders)\/tree$/;

async function openLoadedDashboard(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/pages/tree' && response.ok(),
      { timeout: 20_000 },
    ),
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/folders/tree' && response.ok(),
      { timeout: 20_000 },
    ),
    page.goto('/'),
  ]);
  await expect(page.getByRole('region', { name: 'Sidebar' }).getByText('Loading...')).toHaveCount(
    0,
  );
}

async function delayTreeRefreshes(page: Page): Promise<() => Promise<void>> {
  let release: (() => void) | undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(treeRoutePattern, async (route) => {
    await released;
    await route.continue();
  });
  return async () => {
    release?.();
    await page.unrouteAll({ behavior: 'wait' });
  };
}

test.describe('Dashboard and sidebar consistency', () => {
  test('deleting the open page from the sidebar shows one removal message', async ({ page }) => {
    await openLoadedDashboard(page);
    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/pages' &&
        response.status() === 201,
    );
    await page
      .getByRole('button', { name: /new page/i })
      .first()
      .click();
    const created = (await (await createResponse).json()) as { id: string };
    await page.waitForURL(new RegExp(`/untitled-${created.id}$`));
    await waitForLiveCollaboration(page, 10_000);

    const sidebarPage = page
      .getByRole('region', { name: 'Sidebar' })
      .locator(entitySelector('page', created.id))
      .first();
    await sidebarPage.hover();
    await sidebarPage.getByRole('button', { name: 'Open menu' }).click();
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === `/api/pages/${created.id}` &&
        response.ok(),
    );
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await deleteResponse;
    await page.waitForURL(/\/$/);

    await expect(page.getByText('Moved "Untitled" To Trash', { exact: true })).toHaveCount(1);
    // The collaboration deletion event arrives independently of the HTTP
    // response. Observe a short window to ensure it does not add a second toast.
    await page.waitForTimeout(750);
    await expect(page.getByText('Page deleted', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Removed from your view', { exact: true })).toHaveCount(0);
  });

  test('removing an open nested page navigates to its parent folder', async ({ page }) => {
    const unique = Date.now();
    const folderName = `Removal parent ${unique}`;
    const pageTitle = `Nested removal ${unique}`;
    const folderResponse = await page.request.post('/api/folders', {
      data: { name: folderName },
    });
    expect(folderResponse.status()).toBe(201);
    const folder = (await folderResponse.json()) as { id: string };
    const pageResponse = await page.request.post('/api/pages', {
      data: { title: pageTitle, parentId: folder.id },
    });
    expect(pageResponse.status()).toBe(201);
    const created = (await pageResponse.json()) as { id: string };

    await page.goto(`/page-${created.id}`);
    await waitForLiveCollaboration(page, 10_000);
    const sidebarPage = page
      .getByRole('region', { name: 'Sidebar' })
      .locator(entitySelector('page', created.id))
      .first();
    await expect(sidebarPage).toBeVisible();
    await sidebarPage.hover();
    await sidebarPage.getByRole('button', { name: 'Open menu' }).click();
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === `/api/pages/${created.id}` &&
        response.ok(),
    );
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await deleteResponse;

    await page.waitForURL(new RegExp(`/folder/[^/]*-${folder.id}$`));
    await expect(page.getByText(`Moved "${pageTitle}" To Trash`, { exact: true })).toHaveCount(1);
  });

  test('page creation, rename, and deletion update both views before refetch', async ({ page }) => {
    test.setTimeout(60_000);
    await openLoadedDashboard(page);
    const releaseTreeRefreshes = await delayTreeRefreshes(page);

    try {
      const createResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/pages' &&
          response.status() === 201,
      );
      await page
        .getByRole('button', { name: /new page/i })
        .first()
        .click();
      const created = (await (await createResponse).json()) as { id: string };
      await page.waitForURL(new RegExp(`/untitled-${created.id}$`));

      const sidebarPage = page
        .getByRole('region', { name: 'Sidebar' })
        .locator(entitySelector('page', created.id));
      await expect(sidebarPage.first()).toContainText('Untitled');

      const title = `Creation consistency ${Date.now()}`;
      const titleUpdate = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname === `/api/pages/${created.id}` &&
          response.ok(),
      );
      const titleInput = page.getByTestId('page-title');
      await titleInput.fill(title);
      await titleInput.press('Enter');
      await titleUpdate;
      await expect(sidebarPage.first()).toContainText(title);
      await expect(sidebarPage.last()).toContainText(title);

      await page.getByRole('link', { name: 'Home' }).click();
      await expect(page.locator(`main ${entitySelector('page', created.id)}`)).toContainText(title);

      const dashboardPage = page.locator(`main ${entitySelector('page', created.id)}`);
      await dashboardPage.hover();
      await dashboardPage.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(dashboardPage).toBeVisible();

      await dashboardPage.hover();
      await dashboardPage.getByRole('button', { name: 'Open menu' }).click();
      const deleteResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          new URL(response.url()).pathname === `/api/pages/${created.id}` &&
          response.ok(),
      );
      await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
      await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
      await deleteResponse;

      await expect(page.locator(`main ${entitySelector('page', created.id)}`)).toHaveCount(0);
      await expect(sidebarPage).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
    } finally {
      await releaseTreeRefreshes();
    }
  });

  test('folder creation, rename, and deletion update both views before refetch', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openLoadedDashboard(page);
    const releaseTreeRefreshes = await delayTreeRefreshes(page);

    try {
      const createResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/folders' &&
          response.status() === 201,
      );
      await page.getByRole('button', { name: 'Open new item menu' }).click();
      await page.getByRole('button', { name: 'New Folder', exact: true }).click();
      const created = (await (await createResponse).json()) as { id: string };

      const title = `Folder consistency ${Date.now()}`;
      const folderInput = page.locator(`main ${entitySelector('folder', created.id)} input`);
      await folderInput.fill(title);
      const titleUpdate = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname === `/api/folders/${created.id}` &&
          response.ok(),
      );
      await folderInput.press('Enter');
      await titleUpdate;

      const dashboardFolder = page.locator(`main ${entitySelector('folder', created.id)}`);
      const sidebarFolder = page
        .getByRole('region', { name: 'Sidebar' })
        .locator(entitySelector('folder', created.id));
      await expect(dashboardFolder).toContainText(title);
      await expect(sidebarFolder).toContainText(title);

      await dashboardFolder.hover();
      await dashboardFolder.getByRole('button', { name: 'Open menu' }).click();
      const deleteResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          new URL(response.url()).pathname === `/api/folders/${created.id}` &&
          response.ok(),
      );
      await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
      await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
      await deleteResponse;

      await expect(dashboardFolder).toHaveCount(0);
      await expect(sidebarFolder).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
    } finally {
      await releaseTreeRefreshes();
    }
  });
});
