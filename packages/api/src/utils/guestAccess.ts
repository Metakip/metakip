import { randomUUID } from 'node:crypto';
import { getAnonymousName } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { auth } from '../auth';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { ensureFolderAccess, ensurePageAccess, type SharePermission } from './share-access';

const GUEST_COOKIE_NAME = 'metakip_anon_id';
const GUEST_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type GuestActor = {
  kind: 'guest';
  id: string;
  name: string;
  rotate(): void;
};

export type RequestActor = { kind: 'user'; id: string } | GuestActor;

function readGuestId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== GUEST_COOKIE_NAME) continue;
    try {
      const value = decodeURIComponent(rawValue.join('='));
      return UUID_PATTERN.test(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function getRequestActor(c: Context): Promise<RequestActor> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const user = session?.user as { id?: string } | undefined;
  if (user?.id) return { kind: 'user', id: user.id };

  const guestId = readGuestId(c.req.header('cookie'));
  if (!guestId) {
    throw new HTTPException(401, { message: 'A guest identity is required' });
  }
  const tombstone = await executeQuery<{ exists: boolean }>(
    db,
    sql`select exists(
      select 1 from guest_identity_tombstones where id = ${guestId}
    ) as exists`,
  );
  return createGuestActor(c, tombstone.rows[0]?.exists ? rotateGuestIdentity(c) : guestId);
}

function rotateGuestIdentity(c: Context): string {
  const guestId = randomUUID();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  c.header(
    'Set-Cookie',
    `${GUEST_COOKIE_NAME}=${guestId}; Max-Age=${GUEST_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`,
  );
  return guestId;
}

function createGuestActor(c: Context, guestId: string): GuestActor {
  const actor: GuestActor = {
    kind: 'guest',
    id: guestId,
    name: getAnonymousName(guestId),
    rotate: () => {
      const nextGuestId = rotateGuestIdentity(c);
      actor.id = nextGuestId;
      actor.name = getAnonymousName(nextGuestId);
    },
  };
  return actor;
}

export async function persistGuestIdentity(
  actor: RequestActor,
  executor: QueryExecutor = db,
): Promise<void> {
  if (actor.kind !== 'guest') return;
  if (executor === db) {
    await db.transaction((tx) => persistGuestIdentity(actor, tx));
    return;
  }
  // The database function owns the cleanup lock/tombstone/upsert invariant.
  // Keep the actor mutable only at this request boundary so callers observe a
  // replacement ID when an expired cookie is rotated.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await executeQuery<{ established: boolean }>(
      executor,
      sql`select establish_guest_identity(${actor.id}, ${actor.name}) as established`,
    );
    if (!result.rows[0]?.established) {
      actor.rotate();
      continue;
    }
    return;
  }
  throw new Error('Unable to establish a replacement guest identity');
}

const permissionRank = (permission: SharePermission): number =>
  permission === 'admin' ? 3 : permission === 'edit' ? 2 : 1;

export async function ensureActorPageAccess(
  actor: RequestActor,
  pageId: string,
  mode: 'view' | 'edit' = 'view',
  executor: QueryExecutor = db,
): Promise<SharePermission> {
  if (actor.kind === 'user') {
    return (await ensurePageAccess(pageId, actor.id, mode, executor)).permission;
  }
  const result = await executeQuery<{ permission: SharePermission | null }>(
    executor,
    sql`select get_public_page_permission(${pageId}) as permission`,
  );
  const permission = result.rows[0]?.permission;
  if (!permission) {
    throw new HTTPException(404, { message: 'Page not found' });
  }
  if (permissionRank(permission) < permissionRank(mode)) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }
  await persistGuestIdentity(actor, executor);
  return permission;
}

export async function ensureActorFolderAccess(
  actor: RequestActor,
  folderId: string,
  mode: 'view' | 'edit' = 'view',
  executor: QueryExecutor = db,
): Promise<SharePermission> {
  if (actor.kind === 'user') {
    return (await ensureFolderAccess(folderId, actor.id, mode, executor)).permission;
  }
  const result = await executeQuery<{ permission: SharePermission | null }>(
    executor,
    sql`select get_public_folder_permission(${folderId}) as permission`,
  );
  const permission = result.rows[0]?.permission;
  if (!permission) {
    throw new HTTPException(404, { message: 'Folder not found' });
  }
  if (permissionRank(permission) < permissionRank(mode)) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }
  await persistGuestIdentity(actor, executor);
  return permission;
}

/** Edit grants creation without granting organization, deletion, or access management. */
export async function ensureActorCanCreateInFolder(
  actor: RequestActor,
  folderId: string,
  executor: QueryExecutor = db,
): Promise<void> {
  if (actor.kind === 'guest') {
    throw new HTTPException(403, {
      message: 'Guest editors cannot create or copy pages or folders',
    });
  }
  await ensureActorFolderAccess(actor, folderId, 'edit', executor);
}

export function actorColumns(actor: RequestActor): {
  userId: string | null;
  guestId: string | null;
} {
  return actor.kind === 'user'
    ? { userId: actor.id, guestId: null }
    : { userId: null, guestId: actor.id };
}
