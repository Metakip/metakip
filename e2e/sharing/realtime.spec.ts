import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  test,
  type WebSocketRoute,
} from '@playwright/test';
import { API_URL, WEB_HOSTNAME } from '../fixtures';

type SetupResult = {
  cookie: string;
  userId: string;
};

type EntityResult = {
  id: string;
};

type ShareSummary = {
  accessors: Array<{ grantId?: string | null; userId: string }>;
  accessSources?: Array<{
    kind: 'owner' | 'direct' | 'folder' | 'workspace';
    grantId: string | null;
    userId: string;
    permission: 'view' | 'edit' | 'admin';
    effectivePermission: 'view' | 'edit' | 'admin';
    isWinning: boolean;
  }>;
};

async function createUser(request: APIRequestContext, name: string): Promise<SetupResult> {
  const testToken = process.env.TEST_SETUP_TOKEN;
  if (!testToken) throw new Error('TEST_SETUP_TOKEN is required');
  const response = await request.post(`${API_URL}/api/test/setup`, {
    data: { name },
    headers: { 'x-test-setup-token': testToken },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as SetupResult;
}

async function createAuthenticatedContext(
  browser: Browser,
  session: SetupResult,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: session.cookie,
      domain: WEB_HOSTNAME,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  return context;
}

async function createEntity(
  api: APIRequestContext,
  path: '/api/pages' | '/api/folders',
  data: Record<string, string>,
): Promise<EntityResult> {
  const response = await api.post(path, { data });
  expect(response.status()).toBe(201);
  return (await response.json()) as EntityResult;
}

async function getDirectGrantId(
  ownerApi: APIRequestContext,
  entityType: 'page' | 'folder',
  entityId: string,
  recipientId: string,
): Promise<string> {
  const response = await ownerApi.get(`/api/shares/entity/${entityType}/${entityId}`);
  expect(response.ok()).toBeTruthy();
  const summary = (await response.json()) as ShareSummary;
  const grantId = summary.accessors.find(
    (accessor) => accessor.userId === recipientId && accessor.grantId,
  )?.grantId;
  if (!grantId) throw new Error('Direct grant was not returned');
  return grantId;
}

async function waitForPersistedMarkdown(
  ownerApi: APIRequestContext,
  pageId: string,
  expectedContent: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await ownerApi.get(`/api/pages/${pageId}/export/markdown`);
        return response.ok() ? response.text() : '';
      },
      {
        message: 'expected the collaborative document to be persisted before reloading',
        timeout: 15_000,
      },
    )
    .toContain(expectedContent);
}

test.describe('sharing realtime propagation', () => {
  test.setTimeout(120_000);

  test('keeps direct edit through a View-folder move and cleanly falls back live', async ({
    browser,
    request,
    playwright,
  }) => {
    const owner = await createUser(request, 'Sharing Primitive Owner');
    const recipient = await createUser(request, 'Sharing Primitive Recipient');
    const recipientEmail = `e2e-${recipient.userId.slice(0, 8)}@example.com`;
    const ownerApi = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Cookie: `better-auth.session_token=${owner.cookie}` },
    });
    const ownerContext = await createAuthenticatedContext(browser, owner);
    const recipientContext = await createAuthenticatedContext(browser, recipient);

    try {
      const folder = await createEntity(ownerApi, '/api/folders', {
        name: `Primitive View folder ${Date.now()}`,
      });
      const sharedPage = await createEntity(ownerApi, '/api/pages', {
        title: `Primitive moved page ${Date.now()}`,
      });
      const ownerPage = await ownerContext.newPage();
      const recipientPage = await recipientContext.newPage();
      const initialContent = `PRIMITIVE-CONTENT-${sharedPage.id.slice(0, 8)}`;

      await ownerPage.goto(`/page-${sharedPage.id}`);
      const ownerEditor = ownerPage.locator('.codemirror-editor .cm-content');
      await expect(ownerEditor).toHaveAttribute('contenteditable', 'true');
      await ownerEditor.click();
      await ownerPage.keyboard.type(initialContent);
      // Poll the export path so the reload proves the baseline came from
      // PostgreSQL before any permission transition is attempted.
      await waitForPersistedMarkdown(ownerApi, sharedPage.id, initialContent);
      await ownerPage.reload();
      await expect(ownerPage.locator('.codemirror-editor .cm-content')).toContainText(
        initialContent,
        {
          timeout: 15_000,
        },
      );

      expect(
        (
          await ownerApi.post(`/api/shares/entity/page/${sharedPage.id}/grants`, {
            data: { email: recipientEmail, permission: 'edit' },
          })
        ).ok(),
      ).toBeTruthy();
      expect(
        (
          await ownerApi.post(`/api/shares/entity/folder/${folder.id}/grants`, {
            data: { email: recipientEmail, permission: 'view' },
          })
        ).ok(),
      ).toBeTruthy();
      expect(
        (
          await ownerApi.patch(`/api/pages/${sharedPage.id}/move`, {
            data: { parentId: folder.id },
          })
        ).ok(),
      ).toBeTruthy();

      await recipientPage.goto(`/page-${sharedPage.id}`);
      const recipientEditor = recipientPage.locator('.codemirror-editor .cm-content');
      await expect(recipientEditor).toContainText(initialContent, { timeout: 15_000 });
      await expect(recipientEditor).toHaveAttribute('contenteditable', 'true');

      const summaryResponse = await ownerApi.get(`/api/shares/entity/page/${sharedPage.id}`);
      expect(summaryResponse.ok()).toBeTruthy();
      const summary = (await summaryResponse.json()) as ShareSummary;
      const recipientSources = (summary.accessSources ?? []).filter(
        (source) => source.userId === recipient.userId,
      );
      expect(recipientSources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'direct',
            permission: 'edit',
            effectivePermission: 'edit',
            isWinning: true,
          }),
          expect.objectContaining({
            kind: 'folder',
            permission: 'view',
            effectivePermission: 'edit',
            isWinning: false,
          }),
        ]),
      );

      // A restriction blocks the ancestor source, never the direct grant.
      expect(
        (
          await ownerApi.patch(`/api/shares/entity/page/${sharedPage.id}/inheritance`, {
            data: { policy: 'restricted' },
          })
        ).ok(),
      ).toBeTruthy();
      await expect(recipientEditor).toHaveAttribute('contenteditable', 'true');
      expect(
        (
          await ownerApi.patch(`/api/shares/entity/page/${sharedPage.id}/inheritance`, {
            data: { policy: 'inherit' },
          })
        ).ok(),
      ).toBeTruthy();

      const directGrantId = await getDirectGrantId(
        ownerApi,
        'page',
        sharedPage.id,
        recipient.userId,
      );
      expect((await ownerApi.delete(`/api/shares/grants/${directGrantId}`)).ok()).toBeTruthy();
      await expect(recipientEditor).toHaveAttribute('contenteditable', 'false', {
        timeout: 10_000,
      });
      await expect(recipientEditor).toContainText(initialContent);

      // A view-only peer leaving must not evict or blank the owner's room.
      await recipientPage.goto('/');
      await expect(ownerPage.locator('.codemirror-editor .cm-content')).toContainText(
        initialContent,
      );
      const postDisconnectContent = '-OWNER-AFTER-VIEWER-LEFT';
      await ownerPage.locator('.codemirror-editor .cm-content').click();
      await ownerPage.keyboard.press('End');
      await ownerPage.keyboard.type(postDisconnectContent);
      await waitForPersistedMarkdown(
        ownerApi,
        sharedPage.id,
        `${initialContent}${postDisconnectContent}`,
      );
      await ownerPage.reload();
      await expect(ownerPage.locator('.codemirror-editor .cm-content')).toContainText(
        `${initialContent}${postDisconnectContent}`,
        { timeout: 15_000 },
      );

      // Re-promotion must reconnect to the canonical non-blank document.
      expect(
        (
          await ownerApi.post(`/api/shares/entity/page/${sharedPage.id}/grants`, {
            data: { email: recipientEmail, permission: 'edit' },
          })
        ).ok(),
      ).toBeTruthy();
      await recipientPage.goto(`/page-${sharedPage.id}`);
      await expect(recipientPage.locator('.codemirror-editor .cm-content')).toHaveAttribute(
        'contenteditable',
        'true',
      );
      await expect(recipientPage.locator('.codemirror-editor .cm-content')).toContainText(
        `${initialContent}${postDisconnectContent}`,
      );
    } finally {
      await ownerContext.close();
      await recipientContext.close();
      await ownerApi.dispose();
    }
  });

  test('records a first authenticated public-folder visit and retains it after direct revocation', async ({
    browser,
    request,
    playwright,
  }) => {
    const owner = await createUser(request, 'Public Folder Owner');
    const recipient = await createUser(request, 'Public Folder Visitor');
    const recipientEmail = `e2e-${recipient.userId.slice(0, 8)}@example.com`;
    const ownerApi = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Cookie: `better-auth.session_token=${owner.cookie}` },
    });
    const recipientContext = await createAuthenticatedContext(browser, recipient);

    try {
      const folderName = `First public folder ${Date.now()}`;
      const childTitle = `First public child ${Date.now()}`;
      const folder = await createEntity(ownerApi, '/api/folders', { name: folderName });
      await createEntity(ownerApi, '/api/pages', {
        title: childTitle,
        parentId: folder.id,
      });
      expect(
        (
          await ownerApi.patch(`/api/shares/entity/folder/${folder.id}/public-access`, {
            data: { permission: 'view' },
          })
        ).ok(),
      ).toBeTruthy();

      const recipientPage = await recipientContext.newPage();
      await recipientPage.goto(`/folder/public-${folder.id}`);
      await expect(recipientPage.getByText(childTitle, { exact: true })).toBeVisible();

      expect(
        (
          await ownerApi.post(`/api/shares/entity/folder/${folder.id}/grants`, {
            data: { email: recipientEmail, permission: 'edit' },
          })
        ).ok(),
      ).toBeTruthy();
      const directGrantId = await getDirectGrantId(ownerApi, 'folder', folder.id, recipient.userId);
      expect((await ownerApi.delete(`/api/shares/grants/${directGrantId}`)).ok()).toBeTruthy();

      await recipientPage.goto('/shared-with-me');
      await expect(recipientPage.getByText(folderName, { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      await recipientPage.getByText(folderName, { exact: true }).first().click();
      await expect(recipientPage.getByText(childTitle, { exact: true }).first()).toBeVisible();
    } finally {
      await recipientContext.close();
      await ownerApi.dispose();
    }
  });

  test('refreshes grants, permission fallback, folder revocation, and open share lists', async ({
    browser,
    request,
    playwright,
  }) => {
    const owner = await createUser(request, 'Realtime Sharing Owner');
    const recipient = await createUser(request, 'Realtime Sharing Recipient');
    const recipientEmail = `e2e-${recipient.userId.slice(0, 8)}@example.com`;
    const ownerApi = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Cookie: `better-auth.session_token=${owner.cookie}` },
    });
    const recipientApi = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Cookie: `better-auth.session_token=${recipient.cookie}` },
    });
    const ownerContext = await createAuthenticatedContext(browser, owner);
    const recipientContext = await createAuthenticatedContext(browser, recipient);

    try {
      const ownerPage = await ownerContext.newPage();
      const recipientPage = await recipientContext.newPage();
      const grantTitle = `Realtime direct grant ${Date.now()}`;
      const grantPage = await createEntity(ownerApi, '/api/pages', { title: grantTitle });

      await recipientPage.goto('/');
      await expect(recipientPage.getByText(grantTitle, { exact: true })).toHaveCount(0);
      const grantResponse = await ownerApi.post(`/api/shares/entity/page/${grantPage.id}/grants`, {
        data: { email: recipientEmail, permission: 'view' },
      });
      expect(grantResponse.ok()).toBeTruthy();
      await expect(recipientPage.getByText(grantTitle, { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });

      await ownerPage.goto(`/page-${grantPage.id}`);
      await ownerPage.locator('[data-testid="page-share-btn"]').click();
      await expect(ownerPage.getByRole('dialog')).toContainText('Realtime Sharing Recipient');
      const leaveResponse = await recipientApi.post(`/api/pages/${grantPage.id}/leave`);
      expect(leaveResponse.ok()).toBeTruthy();
      await expect(ownerPage.getByRole('dialog')).not.toContainText('Realtime Sharing Recipient', {
        timeout: 15_000,
      });

      const fallbackPage = await createEntity(ownerApi, '/api/pages', {
        title: `Realtime fallback ${Date.now()}`,
      });
      await ownerApi.patch(`/api/shares/entity/page/${fallbackPage.id}/public-access`, {
        data: { permission: 'view' },
      });
      await ownerApi.post(`/api/shares/entity/page/${fallbackPage.id}/grants`, {
        data: { email: recipientEmail, permission: 'edit' },
      });
      await recipientPage.goto(`/page-${fallbackPage.id}`);
      const fallbackEditor = recipientPage.locator('.codemirror-editor .cm-content');
      await expect(fallbackEditor).toHaveAttribute('contenteditable', 'true');
      const fallbackGrantId = await getDirectGrantId(
        ownerApi,
        'page',
        fallbackPage.id,
        recipient.userId,
      );
      expect((await ownerApi.delete(`/api/shares/grants/${fallbackGrantId}`)).ok()).toBeTruthy();
      await expect(fallbackEditor).toHaveAttribute('contenteditable', 'false', { timeout: 10_000 });

      const folder = await createEntity(ownerApi, '/api/folders', {
        name: `Realtime folder ${Date.now()}`,
      });
      const child = await createEntity(ownerApi, '/api/pages', {
        title: `Realtime folder child ${Date.now()}`,
        parentId: folder.id,
      });
      await ownerApi.post(`/api/shares/entity/folder/${folder.id}/grants`, {
        data: { email: recipientEmail, permission: 'admin' },
      });
      await ownerApi.post(`/api/shares/entity/page/${child.id}/grants`, {
        data: { email: recipientEmail, permission: 'view' },
      });
      await recipientPage.goto(`/page-${child.id}`);
      const inheritedEditor = recipientPage.locator('.codemirror-editor .cm-content');
      await expect(inheritedEditor).toHaveAttribute('contenteditable', 'true');
      expect(
        (
          await ownerApi.patch(`/api/shares/entity/page/${child.id}/inheritance`, {
            data: { policy: 'restricted' },
          })
        ).ok(),
      ).toBeTruthy();
      await expect(inheritedEditor).toHaveAttribute('contenteditable', 'false', {
        timeout: 10_000,
      });
      const childGrantId = await getDirectGrantId(ownerApi, 'page', child.id, recipient.userId);
      expect(
        (
          await ownerApi.patch(`/api/shares/entity/page/${child.id}/inheritance`, {
            data: { policy: 'inherit' },
          })
        ).ok(),
      ).toBeTruthy();
      await expect(inheritedEditor).toHaveAttribute('contenteditable', 'true', {
        timeout: 10_000,
      });
      expect((await ownerApi.delete(`/api/shares/grants/${childGrantId}`)).ok()).toBeTruthy();
      const folderGrantId = await getDirectGrantId(ownerApi, 'folder', folder.id, recipient.userId);
      expect((await ownerApi.delete(`/api/shares/grants/${folderGrantId}`)).ok()).toBeTruthy();
      await expect(recipientPage.locator('.codemirror-editor .cm-content')).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect
        .poll(async () => {
          const redirected = /\/$/.test(new URL(recipientPage.url()).pathname);
          const denied = await recipientPage
            .getByRole('heading', { name: "You don't have access" })
            .isVisible();
          return redirected || denied;
        })
        .toBe(true);
    } finally {
      await ownerContext.close();
      await recipientContext.close();
      await ownerApi.dispose();
      await recipientApi.dispose();
    }
  });

  test('evicts stale anonymous content when reconnect authentication is denied', async ({
    browser,
    request,
    playwright,
  }) => {
    const owner = await createUser(request, 'Reconnect Revocation Owner');
    const ownerApi = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Cookie: `better-auth.session_token=${owner.cookie}` },
    });
    const anonymousContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    let holdCollabReconnects = false;
    const connectedCollabRoutes: WebSocketRoute[] = [];
    const heldCollabRoutes: WebSocketRoute[] = [];
    await anonymousContext.routeWebSocket('**/collab', (route) => {
      if (holdCollabReconnects) {
        heldCollabRoutes.push(route);
        return;
      }
      connectedCollabRoutes.push(route);
      route.connectToServer();
    });

    try {
      const confidentialTitle = `Offline confidential ${Date.now()}`;
      const publicPage = await createEntity(ownerApi, '/api/pages', {
        title: confidentialTitle,
      });
      expect(
        (
          await ownerApi.patch(`/api/shares/entity/page/${publicPage.id}/public-access`, {
            data: { permission: 'edit' },
          })
        ).ok(),
      ).toBeTruthy();

      const anonymousPage = await anonymousContext.newPage();
      await anonymousPage.goto(`/page-${publicPage.id}`);
      const anonymousEditor = anonymousPage.locator('.codemirror-editor .cm-content');
      await expect(anonymousPage.locator('[data-testid="page-title"]')).toHaveValue(
        confidentialTitle,
      );
      await expect(anonymousEditor).toHaveAttribute('contenteditable', 'true');

      // Cut only the collaboration transport and hold its automatic reconnect.
      // HTTP stays online and cached, so the next authoritative page signal is
      // the collaboration server denying authentication after the revoke.
      holdCollabReconnects = true;
      const collabRoute = connectedCollabRoutes.at(-1);
      if (!collabRoute) throw new Error('Expected an active collaboration WebSocket');
      await collabRoute.close({ code: 1012, reason: 'E2E collaboration outage' });
      await expect(anonymousEditor).toHaveAttribute('contenteditable', 'false', {
        timeout: 10_000,
      });
      await expect.poll(() => heldCollabRoutes.length, { timeout: 10_000 }).toBeGreaterThan(0);
      expect(
        (
          await ownerApi.patch(`/api/shares/entity/page/${publicPage.id}/public-access`, {
            data: { permission: 'private' },
          })
        ).ok(),
      ).toBeTruthy();

      holdCollabReconnects = false;
      await Promise.all(
        heldCollabRoutes
          .splice(0)
          .map((route) => route.close({ code: 1012, reason: 'Resume after E2E outage' })),
      );
      await expect(anonymousEditor).toHaveCount(0, { timeout: 15_000 });
      await expect(anonymousPage).toHaveURL(/\/login\/?$/, { timeout: 15_000 });
      await expect(anonymousPage.getByRole('heading', { name: 'Log In' })).toBeVisible();
    } finally {
      await anonymousContext.close();
      await ownerApi.dispose();
    }
  });

  test('refreshes recursive deletion and workspace leave, and persists anonymous titles', async ({
    browser,
    request,
    playwright,
  }) => {
    const owner = await createUser(request, 'Realtime Metadata Owner');
    const member = await createUser(request, 'Realtime Metadata Member');
    const memberEmail = `e2e-${member.userId.slice(0, 8)}@example.com`;
    const ownerApi = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Cookie: `better-auth.session_token=${owner.cookie}` },
    });
    const memberApi = await playwright.request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Cookie: `better-auth.session_token=${member.cookie}` },
    });
    const ownerContext = await createAuthenticatedContext(browser, owner);
    const anonymousContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });

    try {
      const ownerPage = await ownerContext.newPage();
      const anonymousPage = await anonymousContext.newPage();
      const deletedFolder = await createEntity(ownerApi, '/api/folders', {
        name: `Deleted folder ${Date.now()}`,
      });
      const publicPage = await createEntity(ownerApi, '/api/pages', {
        title: `Anonymous title ${Date.now()}`,
        parentId: deletedFolder.id,
      });
      expect(
        (
          await ownerApi.patch(`/api/shares/entity/page/${publicPage.id}/public-access`, {
            data: { permission: 'edit' },
          })
        ).ok(),
      ).toBeTruthy();
      await ownerPage.goto(`/page-${publicPage.id}`);
      await anonymousPage.goto(`/page-${publicPage.id}`);
      await anonymousPage.bringToFront();
      await expect(anonymousPage.locator('.codemirror-editor .cm-content')).toHaveAttribute(
        'contenteditable',
        'true',
      );
      await expect(anonymousPage.locator('[data-testid="page-title"]')).not.toHaveAttribute(
        'readonly',
        '',
      );
      const nextTitle = `Anonymous saved ${publicPage.id.slice(0, 8)}`;
      const titleResponsePromise = anonymousPage.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().endsWith(`/api/pages/${publicPage.id}/title`),
      );
      await anonymousPage.locator('[data-testid="page-title"]').fill(nextTitle);
      await anonymousPage.locator('[data-testid="page-title"]').press('Enter');
      expect((await titleResponsePromise).ok()).toBeTruthy();
      await expect(ownerPage.locator('[data-testid="page-title"]')).toHaveValue(nextTitle, {
        timeout: 10_000,
      });
      const storedPage = await ownerApi.get(`/api/pages/${publicPage.id}`);
      expect((await storedPage.json()) as { title: string }).toMatchObject({ title: nextTitle });

      expect(
        (await ownerApi.delete(`/api/folders/${deletedFolder.id}?force=true`)).ok(),
      ).toBeTruthy();
      await expect(ownerPage.locator('.codemirror-editor .cm-content')).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(anonymousPage.locator('.codemirror-editor .cm-content')).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect
        .poll(async () => {
          const redirected = /\/$/.test(new URL(ownerPage.url()).pathname);
          const missing = await ownerPage.getByText('Page not found', { exact: true }).isVisible();
          return redirected || missing;
        })
        .toBe(true);
      // Anonymous users are sent through the app root, then the auth boundary lands
      // them on login. The editor assertion above is the content-eviction
      // guarantee; this URL assertion proves the old public route is gone.
      await expect(anonymousPage).toHaveURL(/\/login\/?$/, { timeout: 10_000 });
      await expect(anonymousPage.getByRole('heading', { name: 'Log In' })).toBeVisible();

      expect(
        (
          await ownerApi.post('/api/workspace/members/invite', {
            data: { email: memberEmail, role: 'viewer' },
          })
        ).ok(),
      ).toBeTruthy();
      await ownerPage.goto('/settings');
      await expect(ownerPage.getByText('Realtime Metadata Member', { exact: true })).toBeVisible();
      const leaveWorkspace = await memberApi.delete(
        `/api/workspace/members/${member.userId}?workspaceOwnerId=${owner.userId}`,
      );
      expect(leaveWorkspace.ok()).toBeTruthy();
      await expect(ownerPage.getByText('Realtime Metadata Member', { exact: true })).toHaveCount(
        0,
        {
          timeout: 15_000,
        },
      );
    } finally {
      await ownerContext.close();
      await anonymousContext.close();
      await ownerApi.dispose();
      await memberApi.dispose();
    }
  });
});
