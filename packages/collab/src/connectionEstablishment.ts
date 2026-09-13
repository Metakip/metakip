import type { Connection, connectedPayload } from '@hocuspocus/server';
import { COLLAB_TERMINAL_REASONS } from '@metakip/shared';
import { withSerializedPermissionCheck } from './accessVerifier';
import type { AuthenticatedCredential } from './authenticatedCredential';
import { CollabAccessError } from './collabErrors';
import { getAuthenticatedCredential, getSessionUser, isCollabSession } from './collabSession';
import {
  rejectConnectionTraffic,
  releaseConnectionTraffic,
  sendDeferredInitialAwareness,
} from './connectionLifecycle';
import type { CredentialState } from './credentialQueries';
import {
  applyPermissionState,
  type GrantedPermissionState,
  getCurrentPermission,
  sendPermissionSnapshot,
} from './permissionState';

export function createConnectionEstablishmentHook(options: {
  isMetaRoom(documentName: string): boolean;
  getSessionState(userId: string, credential: AuthenticatedCredential): Promise<CredentialState>;
  assertAnonymousPageAccess(documentName: string): Promise<GrantedPermissionState>;
  assertPageAccess(
    documentName: string,
    userId: string,
    credential: AuthenticatedCredential,
  ): Promise<GrantedPermissionState>;
}) {
  return async ({ connection, context, documentName }: connectedPayload): Promise<void> => {
    const session = isCollabSession(context) ? context : undefined;
    if (!session) {
      connection.close({
        code: 4500,
        reason: COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
      });
      return;
    }
    if (session.lifecycle.traffic.gate.state === 'rejected') return;
    await withSerializedPermissionCheck(session, async () => {
      try {
        if (options.isMetaRoom(documentName)) {
          const user = getSessionUser(session);
          if (session.principal.kind !== 'account') return;
          const state = await options.getSessionState(user.id, getAuthenticatedCredential(session));
          applyPermissionState(connection, session, {
            permission: null,
            accessRevision: state.accessRevision,
          });
          if (!state.valid) {
            rejectConnectionTraffic(session);
            connection.close({ code: 4401, reason: COLLAB_TERMINAL_REASONS.SESSION_EXPIRED });
            return;
          }
          if (!releaseConnectionTraffic(session)) return;
          sendPermissionSnapshot(connection, null, state.accessRevision);
          sendDeferredInitialAwareness(connection as Connection);
          return;
        }

        const access =
          session.principal.kind === 'anonymous'
            ? await options.assertAnonymousPageAccess(documentName)
            : await options.assertPageAccess(
                documentName,
                getSessionUser(session).id,
                getAuthenticatedCredential(session),
              );
        applyPermissionState(connection, session, access);
        const permission = getCurrentPermission(session);
        if (!permission) {
          rejectConnectionTraffic(session);
          connection.close({ code: 4401, reason: COLLAB_TERMINAL_REASONS.ACCESS_REVOKED });
          return;
        }
        if (!releaseConnectionTraffic(session)) return;
        sendPermissionSnapshot(connection, permission, session.accessRevision);
        sendDeferredInitialAwareness(connection as Connection);
      } catch (error) {
        if (error instanceof CollabAccessError && error.accessRevision) {
          const applied = applyPermissionState(connection, session, {
            permission: null,
            accessRevision: error.accessRevision,
          }).applied;
          const retained = getCurrentPermission(session);
          if (!applied && retained && releaseConnectionTraffic(session)) {
            sendPermissionSnapshot(connection, retained, session.accessRevision);
            sendDeferredInitialAwareness(connection as Connection);
            return;
          }
          rejectConnectionTraffic(session);
          connection.close({ code: 4401, reason: COLLAB_TERMINAL_REASONS.ACCESS_REVOKED });
          return;
        }
        rejectConnectionTraffic(session);
        connection.close({
          code: 4500,
          reason: COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
        });
      }
    });
  };
}
