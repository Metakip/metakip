import type { beforeHandleMessagePayload, Connection, Document } from '@hocuspocus/server';
import { COLLAB_TERMINAL_REASONS, type StatelessShareMessage } from '@markdawn/shared';
import type { Pool, PoolClient } from 'pg';
import { withSerializedPermissionCheck } from './accessVerifier';
import type { AuthenticatedCredential } from './authenticatedCredential';
import { validateAwarenessIdentity } from './awarenessPolicy';
import { CollabAccessError, CollabProtocolDeniedError } from './collabErrors';
import {
  getProtocolMessageType,
  getYjsWriteUpdate,
  yjsUpdateTouchesRootType,
  yjsUpdateTouchesTitle,
} from './collaborationProtocol';
import {
  type CollabSession,
  getAuthenticatedCredential,
  getSessionUser,
  isAnonymousSession,
  isCollabSession,
  waitForWriteApplications,
} from './collabSession';
import { rejectConnectionTraffic, waitForConnectionTraffic } from './connectionLifecycle';
import type { CredentialState } from './credentialQueries';
import {
  applyPermissionState,
  type GrantedPermissionState,
  getCurrentPermission,
  sendPermissionSnapshot,
} from './permissionState';
import type { createWriteAdmissionRuntime } from './writeAdmissionRuntime';

type MessageHandlerOptions = {
  pool: Pool;
  maxAwarenessPayloadBytes: number;
  isMetaRoom(documentName: string): boolean;
  getSessionState(userId: string, credential: AuthenticatedCredential): Promise<CredentialState>;
  lockDocumentAccessMutation(documentName: string, client: PoolClient): Promise<void>;
  lockActivePage(documentName: string, client: PoolClient): Promise<string>;
  assertAnonymousPageAccess(
    documentName: string,
    client: PoolClient,
  ): Promise<GrantedPermissionState>;
  assertPageAccess(
    documentName: string,
    userId: string,
    credential: AuthenticatedCredential,
    client: PoolClient,
  ): Promise<GrantedPermissionState>;
  writeAdmissions: ReturnType<typeof createWriteAdmissionRuntime>;
  ignoreMessage(message: Uint8Array): void;
};

class WriteFenceTransaction {
  readonly client: PoolClient;
  #open = true;
  #transferred = false;

  private constructor(client: PoolClient) {
    this.client = client;
  }

  static async begin(pool: Pool): Promise<WriteFenceTransaction> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return new WriteFenceTransaction(client);
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async commit(): Promise<void> {
    if (!this.#open) return;
    await this.client.query('COMMIT');
    this.#open = false;
  }

  async rollback(): Promise<void> {
    if (!this.#open) return;
    await this.client.query('ROLLBACK').catch(() => undefined);
    this.#open = false;
  }

  transfer(): void {
    this.#open = false;
    this.#transferred = true;
  }

  release(): void {
    if (!this.#transferred) this.client.release();
  }
}

async function verifyMetaMessage(
  session: CollabSession,
  connection: Connection,
  options: MessageHandlerOptions,
): Promise<void> {
  await withSerializedPermissionCheck(session, async () => {
    if (session.principal.kind !== 'account') throw new CollabAccessError();
    const state = await options.getSessionState(
      getSessionUser(session).id,
      getAuthenticatedCredential(session),
    );
    applyPermissionState(undefined, session, {
      permission: null,
      accessRevision: state.accessRevision,
    });
    if (state.valid) return;
    sendPermissionSnapshot(connection, null, state.accessRevision);
    connection.close({ code: 4401, reason: COLLAB_TERMINAL_REASONS.SESSION_EXPIRED });
    throw new CollabAccessError(state.accessRevision);
  });
}

function publishPermissionChange(
  connection: Connection,
  session: CollabSession,
  permission: GrantedPermissionState['permission'],
): void {
  sendPermissionSnapshot(connection, permission, session.accessRevision);
  connection.sendStateless(
    JSON.stringify({
      type: 'share_event',
      action: 'update',
      permission,
    } satisfies StatelessShareMessage),
  );
}

async function retainAdmissionOrCommit(options: {
  transaction: WriteFenceTransaction;
  runtime: MessageHandlerOptions['writeAdmissions'];
  admission: ReturnType<MessageHandlerOptions['writeAdmissions']['record']>;
  connection: Connection;
  session: CollabSession;
  documentName: string;
  message: Uint8Array;
}): Promise<void> {
  const { transaction, runtime, admission, connection, session, documentName, message } = options;
  if (
    admission &&
    runtime.retainThroughApplication({
      admission,
      connection,
      context: session,
      documentName,
      message,
      client: transaction.client,
    })
  ) {
    transaction.transfer();
    return;
  }
  await transaction.commit();
}

async function verifyPageMessage(
  payload: beforeHandleMessagePayload,
  session: CollabSession,
  writeUpdate: Uint8Array | undefined,
  options: MessageHandlerOptions,
): Promise<void> {
  const { documentName, document, update, connection } = payload;
  await withSerializedPermissionCheck(session, async () => {
    await waitForWriteApplications(session);
    const transaction = await WriteFenceTransaction.begin(options.pool);
    let titleRevision: string | undefined;
    const touchesTitle = writeUpdate
      ? yjsUpdateTouchesTitle(document as Document, writeUpdate)
      : false;
    try {
      await options.lockDocumentAccessMutation(documentName, transaction.client);
      titleRevision = await options.lockActivePage(documentName, transaction.client);
      const user = getSessionUser(session);
      const access = isAnonymousSession(session)
        ? await options.assertAnonymousPageAccess(documentName, transaction.client)
        : await options.assertPageAccess(
            documentName,
            user.id,
            getAuthenticatedCredential(session),
            transaction.client,
          );
      const previousPermission = getCurrentPermission(session);
      const stateApplied = applyPermissionState(connection, session, access).applied;
      const effectivePermission = getCurrentPermission(session);
      if (writeUpdate && effectivePermission !== 'edit' && effectivePermission !== 'admin') {
        await transaction.rollback();
        // Keep the verified read-only subscription alive. CodeMirror and other
        // Yjs bindings may emit normalization updates while mounting even
        // when their UI is non-editable. Hocuspocus's read-only message path
        // rejects the update and sends a failed sync acknowledgement without
        // applying it to the canonical document.
        connection.readOnly = true;
        sendPermissionSnapshot(connection, effectivePermission, session.accessRevision);
        if (stateApplied && previousPermission !== effectivePermission && effectivePermission) {
          connection.sendStateless(
            JSON.stringify({
              type: 'share_event',
              action: 'update',
              permission: effectivePermission,
            } satisfies StatelessShareMessage),
          );
        }
        return;
      }
      const admission = options.writeAdmissions.record(
        session,
        session.accessRevision,
        titleRevision,
        touchesTitle,
        writeUpdate !== undefined,
      );
      await retainAdmissionOrCommit({
        transaction,
        runtime: options.writeAdmissions,
        admission,
        connection,
        session,
        documentName,
        message: update,
      });
      if (stateApplied && previousPermission !== effectivePermission && effectivePermission) {
        publishPermissionChange(connection, session, effectivePermission);
      }
    } catch (error) {
      if (error instanceof CollabAccessError) {
        if (error.accessRevision) {
          const applied = applyPermissionState(connection, session, {
            permission: null,
            accessRevision: error.accessRevision,
          }).applied;
          const retainedPermission = getCurrentPermission(session);
          const canRetainWrite =
            !writeUpdate || retainedPermission === 'edit' || retainedPermission === 'admin';
          if (!applied && retainedPermission && canRetainWrite) {
            const admission = options.writeAdmissions.record(
              session,
              session.accessRevision,
              titleRevision,
              touchesTitle,
              writeUpdate !== undefined,
            );
            await retainAdmissionOrCommit({
              transaction,
              runtime: options.writeAdmissions,
              admission,
              connection,
              session,
              documentName,
              message: update,
            });
            return;
          }
          sendPermissionSnapshot(connection, null, error.accessRevision);
        }
        await transaction.rollback();
        connection.sendStateless(
          JSON.stringify({ type: 'share_event', action: 'revoke' } satisfies StatelessShareMessage),
        );
        connection.close({ code: 4401, reason: COLLAB_TERMINAL_REASONS.ACCESS_REVOKED });
        throw error;
      }
      await transaction.rollback();
      connection.close({
        code: 4500,
        reason: COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
      });
      throw error;
    } finally {
      transaction.release();
    }
  });
}

export function createProtocolMessageHandler(options: MessageHandlerOptions) {
  const handleMessage = async (payload: beforeHandleMessagePayload): Promise<void> => {
    const { documentName, document, update, connection, context } = payload;
    const session = isCollabSession(context) ? context : undefined;
    const protocolMessageType = getProtocolMessageType(update);
    if (protocolMessageType === 5 || protocolMessageType === 6) {
      if (session) rejectConnectionTraffic(session);
      connection.close({ code: 4403, reason: 'Client stateless messages are not allowed' });
      throw new CollabProtocolDeniedError();
    }
    if (!session) throw new Error('Unauthorized');
    if (!(await waitForConnectionTraffic(session, connection))) {
      throw new CollabAccessError(session.accessRevision);
    }

    const isSyncMessage = protocolMessageType === 0 || protocolMessageType === 4;
    const isAwarenessMessage = protocolMessageType === 1 || protocolMessageType === 3;
    let awarenessDisposition: 'apply' | 'ignore' = 'apply';
    if (protocolMessageType === 1) {
      try {
        if (update.byteLength > options.maxAwarenessPayloadBytes) {
          throw new CollabProtocolDeniedError('Awareness payload is too large');
        }
        awarenessDisposition = validateAwarenessIdentity(
          update,
          document as Document,
          connection as Connection,
          session,
        );
      } catch (error) {
        rejectConnectionTraffic(session);
        connection.close({
          code: 4403,
          reason: error instanceof Error ? error.message : 'Invalid awareness identity',
        });
        throw error;
      }
    }

    const writeUpdate = getYjsWriteUpdate(update);
    if (options.isMetaRoom(documentName)) {
      if (isSyncMessage || isAwarenessMessage) {
        await verifyMetaMessage(session, connection as Connection, options);
      }
      if (awarenessDisposition === 'ignore') options.ignoreMessage(update);
      return;
    }
    if (writeUpdate && yjsUpdateTouchesRootType(document, writeUpdate, 'prosemirror')) {
      options.ignoreMessage(update);
      rejectConnectionTraffic(session);
      connection.close({ code: 4403, reason: 'Unsupported editor format' });
      throw new CollabProtocolDeniedError('Unsupported editor format');
    }
    if (!isSyncMessage && !isAwarenessMessage && !writeUpdate) return;
    await verifyPageMessage(payload, session, writeUpdate ?? undefined, options);
    if (awarenessDisposition === 'ignore') options.ignoreMessage(update);
  };

  return async (payload: beforeHandleMessagePayload): Promise<void> => {
    try {
      await handleMessage(payload);
    } catch (error) {
      // Hocuspocus inspects rejected values with the `in` operator. Normalize
      // extension/dependency rejections so a primitive rejection cannot cause
      // a second exception in the connection-close path.
      if (error instanceof Error) throw error;
      throw new Error('Collaboration message rejected', { cause: error });
    }
  };
}
