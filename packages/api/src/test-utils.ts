import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createApp } from './app';
import { testQuery as query } from './db/testQuery';

export async function createTestApp() {
  return createApp();
}

type CreateUserOptions = {
  email?: string;
  name?: string;
};

export async function createTestUser(overrides?: CreateUserOptions) {
  const id = randomUUID();
  const email = overrides?.email ?? `test-${id.slice(0, 8)}@example.com`;
  const name = overrides?.name ?? 'Test User';

  await query(
    `INSERT INTO users (id, email, name, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), NOW())`,
    [id, email, name],
  );

  return { id, email, name };
}

/**
 * Sign a session token using HMAC-SHA256, matching Hono's signed cookie format.
 * `parseSigned` in `hono/utils/cookie` expects: `value.base64(HMAC-SHA256(secret, value))`
 * where the base64 signature is 44 characters ending with ==.
 */
async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  const base64sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${value}.${base64sig}`;
}

export async function createTestSession(userId: string) {
  const token = randomUUID();
  const sessionId = randomUUID();
  const secret = process.env.BETTER_AUTH_SECRET ?? '';
  const signedToken = await signCookieValue(token, secret);

  await query(
    `INSERT INTO sessions (id, token, expires_at, created_at, updated_at, user_id)
     VALUES ($1, $2, NOW() + INTERVAL '1 day', NOW(), NOW(), $3)`,
    [sessionId, token, userId],
  );
  return { Cookie: `better-auth.session_token=${signedToken}`, token: signedToken };
}

type CreatePageOptions = {
  title?: string;
  parentId?: string | null;
};

export async function createTestPage(createdBy: string, overrides?: CreatePageOptions) {
  const id = randomUUID();
  const title = overrides?.title ?? 'Test Page';
  await query(
    `INSERT INTO pages (id, parent_id, title, position, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, '0', $4, NOW(), NOW())`,
    [id, overrides?.parentId ?? null, title, createdBy],
  );
  return { id, title };
}

type CreateFolderOptions = {
  name?: string;
  parentId?: string | null;
  icon?: string | null;
};

export async function createTestFolder(createdBy: string, overrides?: CreateFolderOptions) {
  const id = randomUUID();
  const name = overrides?.name ?? 'Test Folder';
  await query(
    `INSERT INTO folders (id, parent_id, name, icon, position, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '0', $5, NOW(), NOW())`,
    [id, overrides?.parentId ?? null, name, overrides?.icon ?? null, createdBy],
  );
  return { id, name };
}

type CreateVersionOptions = {
  title?: string;
  content?: unknown;
};

export async function createTestVersion(
  pageId: string,
  userId: string,
  overrides?: CreateVersionOptions,
) {
  const id = randomUUID();
  const title = overrides?.title ?? 'Version';
  const content = overrides?.content ?? { type: 'doc', content: [] };
  await query(
    `INSERT INTO page_versions (id, page_id, title, content, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [id, pageId, title, JSON.stringify(content), userId],
  );
  return { id, pageId, title };
}

type CreateTemplateOptions = {
  title?: string;
  contentBlocks?: unknown;
};

export async function createTestTemplate(userId: string, overrides?: CreateTemplateOptions) {
  const id = randomUUID();
  const title = overrides?.title ?? 'Test Template';
  const contentBlocks = overrides?.contentBlocks ?? { type: 'doc', content: [] };
  await query(
    `INSERT INTO templates (id, title, content_blocks, created_by)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [id, title, JSON.stringify(contentBlocks), userId],
  );
  return { id, title };
}

export async function createTestPageLink(sourcePageId: string, targetPageId: string) {
  const id = randomUUID();
  const targetResult = await query<{ title: string }>(
    'select title from pages where id = $1 limit 1',
    [targetPageId],
  );
  const targetTitle = targetResult.rows[0]?.title ?? 'target';

  await query(
    `INSERT INTO connections (
       id, source_type, source_id, target_type, target_id, target_slug,
       target_label, connection_type, link_text, occurrence_count, updated_at
     )
     VALUES ($1, 'page', $2, 'page', $3, $4, $5, 'wikilink', 'link', 1, NOW())`,
    [id, sourcePageId, targetPageId, targetTitle.toLowerCase(), targetTitle],
  );
  return { id, sourcePageId, targetPageId };
}

export async function createTestWorkspaceMember(
  workspaceOwnerId: string,
  memberId: string,
  role: string = 'editor',
) {
  await query(
    `INSERT INTO workspace_members (workspace_owner_id, member_id, role) VALUES ($1, $2, $3)`,
    [workspaceOwnerId, memberId, role],
  );
  return { workspaceOwnerId, memberId, role };
}

export async function enableTestPagePublicAccess(pageId: string) {
  await query("UPDATE pages SET public_permission = 'view' WHERE id = $1", [pageId]);
  return { pageId };
}

/**
 * Create a temporary directory for filesystem-backed test operations
 * (uploads, imports, exports). Returns the path and a cleanup function.
 * The directory is created under os.tmpdir() to avoid polluting the repo.
 */
export function createTestTempDir(prefix = 'metakip-test-'): {
  path: string;
  cleanup: () => void;
} {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return {
    path,
    cleanup: () => {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        void 0;
      }
    },
  };
}

/**
 * Create a temporary file inside a temp directory with the given content.
 * Returns the full file path.
 */
export function createTestTempFile(
  dirPath: string,
  fileName: string,
  content: string | Buffer,
): string {
  const filePath = join(dirPath, fileName);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  return filePath;
}

// NOTE: We intentionally do not export a `mockDbError` helper or test the
// `rowCount === 0` branches after INSERT/UPDATE. In production, Postgres
// either succeeds with rowCount > 0 or throws an exception. The rowCount === 0
// checks are defensive guards for impossible states; testing them would require
// mocking query, which undermines the value of integration tests that use
// a real database.
