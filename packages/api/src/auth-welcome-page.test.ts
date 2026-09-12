import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createAuth } from './auth';
import { testQuery } from './db/testQuery';
import { WELCOME_PAGE_CONTENT, WELCOME_PAGE_TITLE } from './utils/welcomePage';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

type AuthInstance = ReturnType<typeof createAuth>;

function createGoogleIdToken(email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: `google-${randomUUID()}`,
      name: 'Google Welcome Test',
      email,
      email_verified: true,
      picture: 'https://example.com/avatar.png',
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    }),
  ).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

function mockGoogleTokenExchange(email: string): void {
  const idToken = createGoogleIdToken(email);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url !== 'https://oauth2.googleapis.com/token') {
        throw new Error(`Unexpected OAuth request: ${url}`);
      }
      return new Response(
        JSON.stringify({
          access_token: 'google-access-token',
          expires_in: 3600,
          id_token: idToken,
          scope: 'openid email profile',
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
}

function parseSocialSignIn(payload: unknown): { url: string } {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('url' in payload) ||
    typeof payload.url !== 'string'
  ) {
    throw new Error('Google sign-in returned an invalid response');
  }
  return { url: payload.url };
}

async function completeGoogleSignup(testAuth: AuthInstance, email: string): Promise<Response> {
  mockGoogleTokenExchange(email);
  const signInResponse = await testAuth.handler(
    new Request(`${FRONTEND_URL}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: FRONTEND_URL },
      body: JSON.stringify({
        provider: 'google',
        callbackURL: `${FRONTEND_URL}/onboarding/1`,
        disableRedirect: true,
      }),
    }),
  );
  expect(signInResponse.status).toBe(200);
  const signIn = parseSocialSignIn(await signInResponse.json());
  const state = new URL(signIn.url).searchParams.get('state');
  if (!state) throw new Error('Google sign-in URL did not include OAuth state');
  const stateCookie = signInResponse.headers.get('set-cookie')?.split(';', 1)[0];
  if (!stateCookie) throw new Error('Google sign-in did not set an OAuth state cookie');

  return testAuth.handler(
    new Request(
      `${FRONTEND_URL}/api/auth/callback/google?code=test-authorization-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: stateCookie, Origin: FRONTEND_URL } },
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Better Auth welcome page hook', () => {
  it('creates a canonical, favorited welcome page through the Google callback', async () => {
    const email = `welcome-${randomUUID()}@example.com`;
    const callbackResponse = await completeGoogleSignup(createAuth(), email);
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(`${FRONTEND_URL}/onboarding/1`);

    const users = await testQuery<{ id: string }>('select id from users where email = $1', [email]);
    const userId = users.rows[0]?.id;
    if (!userId) throw new Error('Google callback did not create a user');

    const result = await testQuery<{
      id: string;
      title: string;
      icon: string | null;
      position: string;
      properties: Record<string, unknown> | null;
      ydoc: Buffer | null;
    }>(
      `select id, title, icon, position, properties, ydoc
       from pages
       where created_by = $1`,
      [userId],
    );
    expect(result.rows).toHaveLength(1);
    const page = result.rows[0];
    if (!page?.ydoc) throw new Error('Welcome page was created without a Yjs document');
    expect(page).toMatchObject({
      title: WELCOME_PAGE_TITLE,
      icon: '👋',
      position: '0',
      properties: {
        author: 'Atharva Verma',
        url: 'https://atharvaverma.dev/',
        tags: ['markdawn', 'welcome'],
      },
    });

    const document = new Y.Doc();
    Y.applyUpdate(document, page.ydoc);
    const content = document.getText('content').toString();
    expect(content).toBe(WELCOME_PAGE_CONTENT);
    expect(content).toContain("I'm Atharva, the sole developer behind Markdawn");
    expect(content).toContain('Toggle sidebar');
    document.destroy();

    const metadata = await testQuery<{
      favorites: number;
      tagConnections: number;
      workspaceVersions: number;
    }>(
      `select
         (select count(*)::int from user_favorites
          where user_id = $1 and entity_type = 'page' and entity_id = $2) as favorites,
         (select count(*)::int from connections
          where source_id = $2 and connection_type = 'tag') as "tagConnections",
         (select count(*)::int from workspace_access_versions
          where workspace_owner_id = $1) as "workspaceVersions"`,
      [userId, page.id],
    );
    expect(metadata.rows[0]).toEqual({
      favorites: 1,
      tagConnections: 2,
      workspaceVersions: 1,
    });
  });

  it('does not fail Google signup when welcome page provisioning fails', async () => {
    const email = `welcome-failure-${randomUUID()}@example.com`;
    const testAuth = createAuth({
      provisionWelcomePage: async () => {
        throw new Error('Forced welcome page failure');
      },
    });

    const callbackResponse = await completeGoogleSignup(testAuth, email);
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(`${FRONTEND_URL}/onboarding/1`);

    const users = await testQuery<{ count: number }>(
      'select count(*)::int as count from users where email = $1',
      [email],
    );
    expect(users.rows[0]?.count).toBe(1);
  });
});
