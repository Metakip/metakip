import type { Logger } from '@logtape/logtape';
import type { Pool } from 'pg';
import type { AuthenticatedCredential } from './authenticatedCredential';
import { CollabAccessError, CollabVerificationError } from './collabErrors';
import type { CollabSession } from './collabSession';
import {
  credentialPagePermissionKey,
  queryAnonymousPagePermissions,
  queryCredentialPagePermissions,
} from './permissionQueries';
import type { GrantedPermissionState } from './permissionState';

export type PermissionQueryExecutor = Pick<Pool, 'query'>;
export async function withSerializedPermissionCheck<T>(
  context: CollabSession,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = context.lifecycle.permissionChecks.tail;
  const current = previous.catch(() => undefined).then(operation);
  context.lifecycle.permissionChecks.tail = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
}

export function createAccessVerifier(pool: Pool, logger: Logger) {
  async function runPermissionQuery<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new CollabVerificationError(error);
    }
  }

  async function assertPageAccess(
    documentName: string,
    userId: string,
    credential: AuthenticatedCredential,
    executor: PermissionQueryExecutor = pool,
  ): Promise<GrantedPermissionState> {
    const candidate = { pageId: documentName, userId, credential };
    const states = await runPermissionQuery(() =>
      queryCredentialPagePermissions(executor, [candidate]),
    );
    const access = states.get(credentialPagePermissionKey(candidate));
    if (!access) throw new CollabVerificationError('Missing access row');
    const permission = access.permission;
    if (
      permission !== 'view' &&
      permission !== 'commenter' &&
      permission !== 'edit' &&
      permission !== 'admin'
    ) {
      logger.debug(
        `[auth] user=${userId} denied access to page=${documentName} (invalid permission)`,
      );
      throw new CollabAccessError(access.accessRevision);
    }
    return { permission, accessRevision: access.accessRevision };
  }

  async function assertMetaRoomAccess(userId: string, roomUserId: string): Promise<void> {
    if (userId === roomUserId) return;
    logger.debug(`[auth] user=${userId} denied access to meta room for user=${roomUserId}`);
    throw new CollabAccessError();
  }

  async function assertAnonymousPageAccess(
    documentName: string,
    executor: PermissionQueryExecutor = pool,
  ): Promise<GrantedPermissionState> {
    const states = await runPermissionQuery(() =>
      queryAnonymousPagePermissions(executor, [documentName]),
    );
    const state = states.get(documentName);
    const permission = state?.permission;
    const accessRevision = state?.accessRevision;
    if (permission !== 'view' && permission !== 'edit' && permission !== 'admin') {
      logger.debug(`[auth] anonymous denied: page ${documentName} is restricted`);
      throw new CollabAccessError(accessRevision);
    }
    if (!accessRevision) throw new CollabVerificationError('Missing access revision');
    return { permission, accessRevision };
  }

  async function lockDocumentAccessMutation(
    documentName: string,
    executor: PermissionQueryExecutor,
  ): Promise<void> {
    const ownerResult = await runPermissionQuery(() =>
      executor.query<{ owner_id: string | null }>(
        `select coalesce(get_root_folder_owner(p.parent_id), p.created_by) as owner_id
         from pages p where p.id = $1 and p.is_deleted = false`,
        [documentName],
      ),
    );
    const ownerId = ownerResult.rows[0]?.owner_id;
    if (!ownerId) return;
    await runPermissionQuery(() =>
      executor.query('select pg_advisory_xact_lock_shared(hashtextextended($1, 0))', [
        `workspace-access:${ownerId}`,
      ]),
    );
  }

  async function lockActivePage(
    documentName: string,
    executor: PermissionQueryExecutor,
  ): Promise<string> {
    const result = await runPermissionQuery(() =>
      executor.query<{ title_revision: string }>(
        `select title_revision::text as title_revision
         from pages where id = $1 and is_deleted = false for update`,
        [documentName],
      ),
    );
    if (result.rows.length === 0) throw new CollabAccessError();
    const titleRevision = result.rows[0]?.title_revision;
    if (!titleRevision) throw new CollabVerificationError('Missing page title revision');
    return titleRevision;
  }

  return {
    assertAnonymousPageAccess,
    assertMetaRoomAccess,
    assertPageAccess,
    lockActivePage,
    lockDocumentAccessMutation,
  };
}
