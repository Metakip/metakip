import { MCP_INTERNAL_AUTH_HEADER } from '@metakip/shared/node/mcp-internal-auth';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { authenticateV1Request } from '../middleware/v1Auth';
import { lockWorkspaceAccess } from '../utils/share-access';
import { getUploadStorage, isUploadNotFoundError } from '../utils/uploadStorage';

const uploadsRoute = new Hono();

type UploadRow = {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size: number;
  uploaded_by: string | null;
  uploaded_by_guest_id: string | null;
};

const getUploadByFilename = async (filename: string, executor: QueryExecutor = db) => {
  const result = await executeQuery<UploadRow>(
    executor,
    sql`select * from uploads where filename = ${filename} limit 1`,
  );
  return result.rows[0] ?? null;
};

type UploadAccess = {
  has_references: boolean;
  has_accessible_reference: boolean;
};

const getUploadAccess = async (
  executor: QueryExecutor,
  uploadId: string,
  userId: string,
): Promise<UploadAccess> => {
  const result = await executeQuery<UploadAccess>(
    executor,
    sql`SELECT
       EXISTS (
         SELECT 1
         FROM upload_page_refs
         WHERE upload_id = ${uploadId}
       ) AS has_references,
       EXISTS (
         SELECT 1
         FROM upload_page_refs upr
         JOIN LATERAL get_effective_page_permission(upr.page_id, ${userId}) access ON true
         WHERE upr.upload_id = ${uploadId}
           AND access.permission IS NOT NULL
       ) AS has_accessible_reference`,
  );
  const access = result.rows[0];
  if (!access) {
    return { has_references: false, has_accessible_reference: false };
  }
  return access;
};

const isUploadPublic = async (executor: QueryExecutor, uploadId: string): Promise<boolean> => {
  const result = await executeQuery(
    executor,
    sql`SELECT 1
     FROM upload_page_refs reference
     JOIN pages page ON page.id = reference.page_id AND page.is_deleted = false
     WHERE reference.upload_id = ${uploadId}
       AND get_public_page_permission(page.id) IS NOT NULL
     LIMIT 1`,
  );
  return (result.rowCount ?? 0) > 0;
};

const getUploadWorkspaceOwnerIds = async (
  executor: QueryExecutor,
  uploadId: string,
): Promise<string[]> => {
  const result = await executeQuery<{ owner_id: string }>(
    executor,
    sql`SELECT DISTINCT COALESCE(get_root_folder_owner(p.parent_id), p.created_by) AS owner_id
     FROM upload_page_refs upr
     JOIN pages p ON p.id = upr.page_id
     WHERE upr.upload_id = ${uploadId}
     ORDER BY owner_id`,
  );
  return result.rows.map((row) => row.owner_id);
};

const authorizeUploadDownload = async (
  filename: string,
  user: { id: string } | undefined,
): Promise<{ upload: UploadRow; cacheControl: string }> =>
  db.transaction(async (tx) => {
    const candidateUpload = await getUploadByFilename(filename, tx);
    if (!candidateUpload) {
      throw new HTTPException(404, { message: 'Not found' });
    }

    // Every operation that can change an upload's referenced pages or their
    // access state takes the corresponding workspace lock. Hold all current
    // owners in stable order, then re-read the reference set before checking
    // access so a revoke, public-access change, move, copy, or purge cannot
    // invalidate this authorization while it is being established.
    const ownerIds = await getUploadWorkspaceOwnerIds(tx, candidateUpload.id);
    for (const ownerId of ownerIds) {
      await lockWorkspaceAccess(tx, ownerId);
    }
    const currentOwnerIds = await getUploadWorkspaceOwnerIds(tx, candidateUpload.id);
    const lockedOwnerIds = new Set(ownerIds);
    if (currentOwnerIds.some((ownerId) => !lockedOwnerIds.has(ownerId))) {
      throw new HTTPException(409, {
        message: 'Upload references changed while acquiring access lock; retry the request',
      });
    }

    const upload = await getUploadByFilename(filename, tx);
    if (!upload || upload.id !== candidateUpload.id) {
      throw new HTTPException(404, { message: 'Not found' });
    }

    let cacheControl = 'private, no-store';
    if (user) {
      const access = await getUploadAccess(tx, upload.id, user.id);
      const canUseOrphanFallback = upload.uploaded_by === user.id && !access.has_references;
      if (!access.has_accessible_reference && !canUseOrphanFallback) {
        throw new HTTPException(403, { message: "You don't have access to this file" });
      }
    } else if (await isUploadPublic(tx, upload.id)) {
      cacheControl = 'public, max-age=0, must-revalidate';
    } else {
      throw new HTTPException(404, { message: 'Not found' });
    }

    return { upload, cacheControl };
  });

const readUploadBytes = async (filename: string): Promise<Buffer> => {
  try {
    return await getUploadStorage().get(filename);
  } catch (error) {
    if (isUploadNotFoundError(error)) {
      throw new HTTPException(404, { message: 'File not found' });
    }
    throw new HTTPException(503, { message: 'File storage is unavailable', cause: error });
  }
};

uploadsRoute.get('/:filename', async (c) => {
  const filename = c.req.param('filename');

  // Validate filename - only allow alphanumeric, dash, underscore, dot
  if (!/^[a-zA-Z0-9\-_.]+$/.test(filename)) {
    throw new HTTPException(400, { message: 'Invalid filename' });
  }

  c.header('Cache-Control', 'no-store');
  const principal = await authenticateV1Request(c.req.raw);
  if (!principal && (c.req.header('authorization') || c.req.header(MCP_INTERNAL_AUTH_HEADER))) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  if (principal && principal.kind !== 'session' && !principal.scopes.has('pages:read')) {
    throw new HTTPException(403, { message: 'Token requires pages:read' });
  }
  const user = principal ? { id: principal.userId } : undefined;

  // Gate remote storage work behind an initial access check, but never hold a
  // database connection or workspace lock while reading the object. Recheck
  // afterward so access revoked during the read cannot return protected bytes.
  const initialAuthorization = await authorizeUploadDownload(filename, user);
  const fileBuffer = await readUploadBytes(filename);
  const authorized = await authorizeUploadDownload(filename, user);
  if (authorized.upload.id !== initialAuthorization.upload.id) {
    throw new HTTPException(404, { message: 'Not found' });
  }

  c.header('Cache-Control', authorized.cacheControl);
  return c.body(new Uint8Array(fileBuffer), 200, {
    'Content-Type': authorized.upload.mime_type,
    'Content-Length': authorized.upload.size.toString(),
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
});

export default uploadsRoute;
