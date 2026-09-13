import type { onAuthenticatePayload } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import { getAnonymousName, parsePageMetaRoomName } from '@metakip/shared';
import type { Pool } from 'pg';
import type { AuthenticatedCredential } from './authenticatedCredential';
import { CollabAccessError, CollabGuestIdentityExpiredError } from './collabErrors';
import { type CollabSession, createCollabSession } from './collabSession';
import { createConnectionLifecycle } from './connectionLifecycle';
import { queryAuthenticatedSession } from './credentialQueries';
import type { GrantedPermissionState } from './permissionState';
import { isUuid, parseCookies } from './utils';

type SessionAuthenticatorOptions = {
  pool: Pool;
  logger: Logger;
  isDocumentBlocked(documentName: string): boolean;
  isMetaRoom(documentName: string): boolean;
  assertAnonymousPageAccess(documentName: string): Promise<GrantedPermissionState>;
  assertPageAccess(
    documentName: string,
    userId: string,
    credential: AuthenticatedCredential,
  ): Promise<GrantedPermissionState>;
  assertMetaRoomAccess(userId: string, roomUserId: string): Promise<void>;
};

function getSessionToken(payload: onAuthenticatePayload): string {
  const cookies = parseCookies(payload.requestHeaders.get('cookie') ?? '');
  const bearerToken = payload.requestHeaders
    .get('authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  return (
    payload.token?.trim() ||
    bearerToken ||
    cookies.get('better-auth.session_token')?.trim() ||
    cookies.get('__Secure-better-auth.session_token')?.trim() ||
    ''
  );
}

export function createSessionAuthenticator(options: SessionAuthenticatorOptions) {
  const {
    pool,
    logger,
    isDocumentBlocked,
    isMetaRoom,
    assertAnonymousPageAccess,
    assertPageAccess,
    assertMetaRoomAccess,
  } = options;

  return async (payload: onAuthenticatePayload): Promise<CollabSession> => {
    const { documentName, connectionConfig } = payload;
    if (documentName && isDocumentBlocked(documentName)) throw new CollabAccessError();
    const sessionToken = getSessionToken(payload);
    if (!sessionToken) {
      logger.debug('[auth] no session token provided');
      throw new Error('Unauthorized');
    }

    if (sessionToken.startsWith('anon:')) {
      const anonymousId = sessionToken.slice(5);
      if (!isUuid(anonymousId) || !documentName || !isUuid(documentName)) {
        logger.debug('[auth] anonymous token requires valid UUID identity and document name');
        throw new Error('Forbidden');
      }
      const access = await assertAnonymousPageAccess(documentName);
      const anonymousName = getAnonymousName(anonymousId);
      const identity = await pool.query<{ established: boolean }>(
        'select establish_guest_identity($1, $2) as established',
        [anonymousId, anonymousName],
      );
      if (!identity.rows[0]?.established) throw new CollabGuestIdentityExpiredError();
      if (access.permission === 'view') connectionConfig.readOnly = true;
      logger.info(
        `[auth] anonymous user=${anonymousId} connected to page=${documentName} (permission=${access.permission})`,
      );
      return createCollabSession({
        principal: {
          kind: 'anonymous',
          user: { id: anonymousId, name: anonymousName },
          sessionToken: `anon:${anonymousId}`,
        },
        permission: access.permission,
        accessRevision: access.accessRevision,
        lifecycle: createConnectionLifecycle(),
      });
    }

    const authenticated = await queryAuthenticatedSession(pool, sessionToken);
    if (!authenticated) {
      logger.debug('[auth] invalid/expired session');
      throw new Error('Unauthorized');
    }
    const { user, accessRevision: sessionAccessRevision } = authenticated;
    if (!documentName) throw new CollabAccessError(sessionAccessRevision);

    let permission: CollabSession['permission'] = null;
    let accessRevision = sessionAccessRevision;
    if (isMetaRoom(documentName)) {
      const roomUserId = parsePageMetaRoomName(documentName);
      if (!roomUserId) throw new CollabAccessError(accessRevision);
      await assertMetaRoomAccess(user.id, roomUserId);
      connectionConfig.readOnly = true;
    } else {
      if (!isUuid(documentName)) throw new CollabAccessError(accessRevision);
      const access = await assertPageAccess(documentName, user.id, authenticated.credential);
      permission = access.permission;
      accessRevision = access.accessRevision;
      if (permission === 'view') connectionConfig.readOnly = true;
    }

    logger.info(`[auth] authenticated user=${user.id} (${user.email}) permission=${permission}`);
    return createCollabSession({
      principal: { kind: 'account', user, credential: authenticated.credential },
      permission,
      accessRevision,
      lifecycle: createConnectionLifecycle(),
    });
  };
}
