import type { onLoadDocumentPayload } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import { parsePageMetaRoomName } from '@metakip/shared';
import type { Pool, PoolClient, QueryResult } from 'pg';
import * as Y from 'yjs';
import type { AuthenticatedCredential } from './authenticatedCredential';
import { CollabAccessError } from './collabErrors';
import { sanitizeCanonicalYjsUpdate } from './collaborationProtocol';
import { getAuthenticatedCredential, getSessionUser, isCollabSession } from './collabSession';
import type { CredentialState } from './credentialQueries';
import { getDocumentContentHash } from './documentContentHash';
import { DocumentSizeLimitError } from './documentSizeError';
import { rebuildPageMetaDocument } from './pageMetadata';
import type { PageTitleRuntime } from './pageTitleRuntime';
import { applyPermissionState, type GrantedPermissionState } from './permissionState';
import { isUuid } from './utils';

export function createDocumentLoader(options: {
  pool: Pool;
  logger: Logger;
  maxDocumentBytes: number;
  titles: PageTitleRuntime;
  isMetaRoom(documentName: string): boolean;
  resetDocumentState(documentName: string): void;
  setDocumentSizeEstimate(documentName: string, size: number): void;
  setDocumentContentHash(documentName: string, hash: string): void;
  assertMetaRoomAccess(userId: string, roomUserId: string): Promise<void>;
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
}) {
  return async ({
    documentName,
    document,
    context,
    connectionConfig,
  }: onLoadDocumentPayload): Promise<void> => {
    options.resetDocumentState(documentName);
    options.titles.clear(documentName);
    const session = isCollabSession(context) ? context : undefined;
    if (!session) throw new Error('Unauthorized');

    if (options.isMetaRoom(documentName)) {
      const userId = parsePageMetaRoomName(documentName);
      if (!userId) throw new CollabAccessError(session.accessRevision);
      const sessionUser = getSessionUser(session);
      await options.assertMetaRoomAccess(sessionUser.id, userId);
      if (session.principal.kind !== 'account') throw new CollabAccessError(session.accessRevision);
      const state = await options.getSessionState(
        sessionUser.id,
        getAuthenticatedCredential(session),
      );
      applyPermissionState(undefined, session, {
        permission: null,
        accessRevision: state.accessRevision,
      });
      if (!state.valid) throw new CollabAccessError(state.accessRevision);
      options.logger.debug(`[meta] loading page meta for user: ${userId}`);
      await rebuildPageMetaDocument(options.pool, userId, document, options.logger);
      return;
    }
    if (!isUuid(documentName)) {
      options.logger.debug(`skipping non-meta, non-UUID room: ${documentName}`);
      return;
    }

    const client = await options.pool.connect();
    let result: QueryResult<{ ydoc: Buffer | null; title: string }>;
    try {
      await client.query('begin');
      await options.lockDocumentAccessMutation(documentName, client);
      await options.lockActivePage(documentName, client);
      const access =
        session.principal.kind === 'anonymous'
          ? await options.assertAnonymousPageAccess(documentName, client)
          : await options.assertPageAccess(
              documentName,
              getSessionUser(session).id,
              getAuthenticatedCredential(session),
              client,
            );
      applyPermissionState(connectionConfig, session, access);
      result = await client.query<{ ydoc: Buffer | null; title: string }>(
        'select ydoc, title from pages where id = $1 and is_deleted = false',
        [documentName],
      );
      const storedPage = result.rows[0];
      if (storedPage?.ydoc && storedPage.ydoc.length > 0) {
        const canonicalState = Buffer.from(
          sanitizeCanonicalYjsUpdate(new Uint8Array(storedPage.ydoc)),
        );
        if (!canonicalState.equals(storedPage.ydoc)) {
          await client.query('update pages set ydoc = $1 where id = $2', [
            canonicalState,
            documentName,
          ]);
          storedPage.ydoc = canonicalState;
        }
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const row = result.rows[0];
    if (!row) throw new CollabAccessError(session.accessRevision);
    const canonicalTitle = row.title || 'Untitled';
    options.setDocumentContentHash(
      documentName,
      getDocumentContentHash(row.ydoc ? new Uint8Array(row.ydoc) : null),
    );
    options.titles.rememberLoaded(documentName, canonicalTitle);
    if (!row.ydoc || row.ydoc.length === 0) {
      options.setDocumentSizeEstimate(documentName, 0);
      return;
    }
    if (row.ydoc.length > options.maxDocumentBytes) {
      options.logger.warn(
        `[size] refused to load page=${documentName}: stored document is ${row.ydoc.length} bytes (limit ${options.maxDocumentBytes})`,
      );
      throw new DocumentSizeLimitError();
    }

    options.setDocumentSizeEstimate(documentName, row.ydoc.length);
    options.logger.debug(`Loading document: ${documentName}, size: ${row.ydoc.length} bytes`);
    Y.applyUpdate(document, new Uint8Array(row.ydoc));
    const yjsTitle = document.getText('title').toString();
    if (yjsTitle !== row.title) {
      document.transact(() => {
        const title = document.getText('title');
        title.delete(0, title.length);
        title.insert(0, row.title);
      });
    }
    const loadedSize = Y.encodeStateAsUpdate(document).length;
    if (loadedSize > options.maxDocumentBytes) {
      options.logger.warn(
        `[size] refused to load page=${documentName}: reconciled document is ${loadedSize} bytes (limit ${options.maxDocumentBytes})`,
      );
      throw new DocumentSizeLimitError();
    }
    options.setDocumentSizeEstimate(documentName, loadedSize);
  };
}
