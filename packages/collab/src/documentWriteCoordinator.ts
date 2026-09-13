import type { Document, Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import {
  COLLAB_DOCUMENT_RELOAD_REASONS,
  COLLAB_TERMINAL_REASONS,
  type SharePermission,
} from '@metakip/shared';
import type { Pool } from 'pg';
import type { PermissionQueryExecutor } from './accessVerifier';
import type { AuthenticatedCredential } from './authenticatedCredential';
import { CollabAccessError, CollabVerificationError } from './collabErrors';
import {
  type CollabSession,
  getAuthenticatedCredential,
  getSessionToken,
  getSessionUser,
  isAnonymousSession,
  isCollabSession,
} from './collabSession';
import type { ConnectionResolutionPrincipal } from './connectionIndex';
import type { WriteAdmission } from './connectionLifecycle';
import { createDocumentContentLock } from './documentContentLock';
import {
  applyPagePermissionTransition,
  applyPermissionState,
  type GrantedPermissionState,
  getCurrentPermission,
} from './permissionState';

type PendingWriter = {
  context: CollabSession;
  version: number;
  admittedAccessRevision?: string;
};

type AccessVerifier = {
  assertAnonymousPageAccess(
    pageId: string,
    executor?: PermissionQueryExecutor,
  ): Promise<GrantedPermissionState>;
  assertPageAccess(
    pageId: string,
    userId: string,
    credential: AuthenticatedCredential,
    executor?: PermissionQueryExecutor,
  ): Promise<GrantedPermissionState>;
  lockDocumentAccessMutation(pageId: string, executor: PermissionQueryExecutor): Promise<void>;
};

type CoordinatorOptions = {
  pool: Pool;
  logger: Logger;
  maxDocumentBytes: number;
  getHocuspocus(): Hocuspocus;
  access: AccessVerifier;
};

export function createDocumentWriteCoordinator({
  pool,
  logger,
  maxDocumentBytes,
  getHocuspocus,
  access,
}: CoordinatorOptions) {
  const pendingWriters = new Map<string, Map<string, PendingWriter>>();
  const documentChangeVersions = new Map<string, number>();
  const blockedDocuments = new Set<string>();
  const documentSizeEstimates = new Map<string, number>();
  const documentContentHashes = new Map<string, string>();
  const contentLock = createDocumentContentLock();

  function resetDocumentState(documentName: string): void {
    blockedDocuments.delete(documentName);
    pendingWriters.delete(documentName);
    documentChangeVersions.delete(documentName);
    documentSizeEstimates.delete(documentName);
    documentContentHashes.delete(documentName);
  }

  function updateRevalidatedConnections(
    documentName: string,
    user: { id: string; kind: CollabSession['principal']['kind'] },
    permission: SharePermission | null,
    accessRevision: string,
  ): void {
    const activeDocument = getHocuspocus().documents.get(documentName) as Document | undefined;
    for (const connection of activeDocument?.getConnections() ?? []) {
      const context = isCollabSession(connection.context) ? connection.context : undefined;
      if (
        !context ||
        context.principal.kind !== user.kind ||
        getSessionUser(context).id !== user.id
      ) {
        continue;
      }
      applyPagePermissionTransition(connection, context, { permission, accessRevision });
    }
  }

  function blockDocumentForReload(documentName: string, code: number, reason: string): void {
    const activeDocument = getHocuspocus().documents.get(documentName) as Document | undefined;
    // A reload only has meaning for a document that is currently serving
    // clients. Retaining a block for an inactive document would reject a
    // future, unrelated connection until this process restarts.
    if (!activeDocument) {
      resetDocumentState(documentName);
      return;
    }
    if (blockedDocuments.has(documentName)) return;
    blockedDocuments.add(documentName);
    pendingWriters.delete(documentName);
    documentChangeVersions.delete(documentName);
    documentSizeEstimates.delete(documentName);
    documentContentHashes.delete(documentName);
    for (const connection of activeDocument.getConnections()) connection.close({ code, reason });
  }

  function blockOversizedDocument(documentName: string, size: number): void {
    logger.warn(
      `[size] blocked page=${documentName}: encoded document is ${size} bytes (limit ${maxDocumentBytes})`,
    );
    blockDocumentForReload(documentName, 1009, 'Document size limit exceeded');
  }

  async function canPersistDocument(
    documentName: string,
    context: CollabSession | undefined,
    executor: PermissionQueryExecutor = pool,
  ): Promise<boolean> {
    if (!context) return false;
    const user = getSessionUser(context);
    try {
      const state = isAnonymousSession(context)
        ? await access.assertAnonymousPageAccess(documentName, executor)
        : await access.assertPageAccess(
            documentName,
            user.id,
            getAuthenticatedCredential(context),
            executor,
          );
      applyPermissionState(undefined, context, state);
      updateRevalidatedConnections(
        documentName,
        { id: user.id, kind: context.principal.kind },
        state.permission,
        state.accessRevision,
      );
      const permission = getCurrentPermission(context);
      if (permission === 'edit' || permission === 'admin') return true;
      logger.warn(
        `[persist] permission is not writable for user=${user.id} on page=${documentName}, skipping persist`,
      );
      return false;
    } catch (error) {
      if (!(error instanceof CollabAccessError)) throw error;
      if (error.accessRevision) {
        applyPermissionState(undefined, context, {
          permission: null,
          accessRevision: error.accessRevision,
        });
        updateRevalidatedConnections(
          documentName,
          { id: user.id, kind: context.principal.kind },
          null,
          error.accessRevision,
        );
      }
      logger.warn(
        `[persist] access revoked for user=${user.id} on page=${documentName}, skipping persist`,
      );
      return false;
    }
  }

  async function canPersistPendingDocument(
    documentName: string,
    fallbackContext: CollabSession | undefined,
    executor?: PermissionQueryExecutor,
    maximumWriterVersion = Number.POSITIVE_INFINITY,
  ): Promise<boolean> {
    if (blockedDocuments.has(documentName)) return false;
    try {
      if (executor) await access.lockDocumentAccessMutation(documentName, executor);
      if (blockedDocuments.has(documentName)) return false;
      const writers = Array.from(pendingWriters.get(documentName)?.values() ?? []).filter(
        (writer) => writer.version <= maximumWriterVersion,
      );
      if (writers.length === 0 && fallbackContext) {
        writers.push({ context: fallbackContext, version: maximumWriterVersion });
      }
      if (writers.length === 0) return false;
      for (const writer of writers) {
        if (writer.admittedAccessRevision) continue;
        if (await canPersistDocument(documentName, writer.context, executor ?? pool)) continue;
        blockDocumentForReload(documentName, 4500, COLLAB_DOCUMENT_RELOAD_REASONS.RELOAD_REQUIRED);
        return false;
      }
      return true;
    } catch (error) {
      if (error instanceof CollabVerificationError) {
        logger.warn(
          `[persist] blocking page=${documentName} after permission verification failed: ${error.originalError}`,
        );
        blockDocumentForReload(
          documentName,
          4500,
          COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
        );
        return false;
      }
      logger.error(
        `[persist] unexpected permission revalidation failure for page=${documentName}: ${error}`,
      );
      try {
        blockDocumentForReload(
          documentName,
          4500,
          COLLAB_TERMINAL_REASONS.PERMISSION_VERIFICATION_FAILED,
        );
      } catch (blockError) {
        logger.error(
          `[persist] failed to block page=${documentName} after unexpected error: ${blockError}`,
        );
      }
      throw error;
    }
  }

  function getConnectionResolutionPrincipals(
    documentName: string,
    fallbackContext: CollabSession | undefined,
    maximumWriterVersion: number,
  ): ConnectionResolutionPrincipal[] {
    const contexts = Array.from(pendingWriters.get(documentName)?.values() ?? [])
      .filter((writer) => writer.version <= maximumWriterVersion)
      .map((writer) => writer.context);
    if (contexts.length === 0 && fallbackContext) contexts.push(fallbackContext);
    const principals = new Map<string, ConnectionResolutionPrincipal>();
    for (const context of contexts) {
      const user = getSessionUser(context);
      const principal = { userId: user.id, isAnonymous: isAnonymousSession(context) };
      principals.set(
        `${principal.isAnonymous ? 'anonymous' : 'user'}:${principal.userId}`,
        principal,
      );
    }
    return [...principals.values()];
  }

  function clearPersistedWriters(documentName: string, maximumWriterVersion: number): void {
    const writers = pendingWriters.get(documentName);
    if (!writers) return;
    for (const [key, writer] of writers) {
      if (writer.version <= maximumWriterVersion) writers.delete(key);
    }
    if (writers.size === 0) pendingWriters.delete(documentName);
  }

  function recordDocumentChange(
    documentName: string,
    context: CollabSession,
    admission: WriteAdmission | undefined,
  ): void {
    const user = getSessionUser(context);
    const writerKey = `${context.principal.kind}:${user.id}:${getSessionToken(context)}`;
    const version = (documentChangeVersions.get(documentName) ?? 0) + 1;
    documentChangeVersions.set(documentName, version);
    const writer: PendingWriter = {
      context,
      version,
      ...(admission ? { admittedAccessRevision: admission.accessRevision } : {}),
    };
    const writers = pendingWriters.get(documentName);
    if (writers) writers.set(writerKey, writer);
    else pendingWriters.set(documentName, new Map([[writerKey, writer]]));
  }

  return {
    blockDocumentForReload,
    blockOversizedDocument,
    canPersistPendingDocument,
    clearPersistedWriters,
    getConnectionResolutionPrincipals,
    getDocumentChangeVersion: (documentName: string) =>
      documentChangeVersions.get(documentName) ?? 0,
    getDocumentContentHash: (documentName: string) => documentContentHashes.get(documentName),
    getDocumentSizeEstimate: (documentName: string) => documentSizeEstimates.get(documentName) ?? 0,
    isDocumentBlocked: (documentName: string) => blockedDocuments.has(documentName),
    resetDocumentState,
    recordDocumentChange,
    setDocumentContentHash: (documentName: string, hash: string) =>
      documentContentHashes.set(documentName, hash),
    setDocumentSizeEstimate: (documentName: string, size: number) =>
      documentSizeEstimates.set(documentName, size),
    withDocumentContentLock: contentLock.run,
  };
}
