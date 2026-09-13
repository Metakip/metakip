import type { Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import { COLLAB_DOCUMENT_RELOAD_REASONS } from '@metakip/shared';
import type { Pool, PoolClient } from 'pg';
import * as Y from 'yjs';
import type { CollabSession } from './collabSession';
import { type DocumentPersistenceMutation, persistDocument } from './documentPersistence';
import { DocumentSizeLimitError } from './documentSizeError';
import type { PageTitleRuntime } from './pageTitleRuntime';

type DocumentFlusherOptions = {
  pool: Pool;
  logger: Logger;
  maxDocumentBytes: number;
  titles: PageTitleRuntime;
  getHocuspocus(): Hocuspocus;
  getDocumentChangeVersion(documentName: string): number;
  getConnectionResolutionPrincipals(
    documentName: string,
    fallbackContext: CollabSession | undefined,
    maximumWriterVersion: number,
  ): Array<{ userId: string; isAnonymous: boolean }>;
  canPersistPendingDocument(
    documentName: string,
    fallbackContext: CollabSession | undefined,
    executor?: PoolClient,
    maximumWriterVersion?: number,
  ): Promise<boolean>;
  clearPersistedWriters(documentName: string, maximumWriterVersion: number): void;
  setDocumentSizeEstimate(documentName: string, size: number): void;
  getDocumentContentHash(documentName: string): string | undefined;
  setDocumentContentHash(documentName: string, hash: string): void;
  withDocumentContentLock<T>(documentName: string, task: () => Promise<T>): Promise<T>;
  blockDocumentForReload(documentName: string, code: number, reason: string): void;
  blockOversizedDocument(documentName: string, size: number): void;
};

export type DocumentFlushResult =
  | { status: 'persisted'; state: Uint8Array }
  | { status: 'stale' }
  | { status: 'skipped'; reason: 'invalid_title' | 'unauthorized' | 'empty' | 'oversized' };

export function createDocumentFlusher(options: DocumentFlusherOptions) {
  return async function flushDocument(
    documentName: string,
    document: Y.Doc,
    fallbackContext: CollabSession | undefined,
    source: 'persist' | 'disconnect',
    mutation?: DocumentPersistenceMutation,
    contentLockAlreadyHeld = false,
  ): Promise<DocumentFlushResult> {
    const flush = async (): Promise<DocumentFlushResult> => {
      if (!options.titles.ensureWithinLimit(documentName, document)) {
        return { status: 'skipped', reason: 'invalid_title' };
      }
      const writerVersion = options.getDocumentChangeVersion(documentName);
      const principals = options.getConnectionResolutionPrincipals(
        documentName,
        fallbackContext,
        writerVersion,
      );
      const state = Y.encodeStateAsUpdate(document);
      if (
        !(await options.canPersistPendingDocument(
          documentName,
          fallbackContext,
          undefined,
          writerVersion,
        ))
      ) {
        return { status: 'skipped', reason: 'unauthorized' };
      }
      if (state.length === 0) return { status: 'skipped', reason: 'empty' };
      if (state.length > options.maxDocumentBytes) {
        options.blockOversizedDocument(documentName, state.length);
        return { status: 'skipped', reason: 'oversized' };
      }
      options.logger.info(`[${source}] saving: ${documentName}, size: ${state.length} bytes`);
      try {
        const persisted = await persistDocument({
          pool: options.pool,
          hocuspocus: options.getHocuspocus(),
          documentName,
          document,
          connectionSnapshotState: state,
          connectionResolutionPrincipals: principals,
          lastCanonicalTitle: options.titles.getCanonical(documentName),
          getPendingTitleBaseline: () => options.titles.getPendingBaseline(documentName),
          maxDocumentBytes: options.maxDocumentBytes,
          logger: options.logger,
          expectedContentHash: options.getDocumentContentHash(documentName),
          authorizePersistence: (client) =>
            options.canPersistPendingDocument(documentName, fallbackContext, client, writerVersion),
          ...(mutation ? { mutation } : {}),
        });
        if (!persisted.committed) {
          if (persisted.staleContent) {
            options.blockDocumentForReload(
              documentName,
              4500,
              COLLAB_DOCUMENT_RELOAD_REASONS.CONTENT_REPLACED,
            );
          }
          return persisted.staleContent
            ? { status: 'stale' }
            : { status: 'skipped', reason: 'unauthorized' };
        }
        options.clearPersistedWriters(documentName, writerVersion);
        options.titles.rememberPersisted(documentName, persisted.canonicalTitle);
        options.setDocumentContentHash(documentName, persisted.contentHash);
        options.setDocumentSizeEstimate(documentName, persisted.stateSize);
        options.logger.debug(`[${source}] saved: ${documentName}`);
        return { status: 'persisted', state: persisted.state };
      } catch (error) {
        if (error instanceof DocumentSizeLimitError) {
          options.blockOversizedDocument(documentName, Y.encodeStateAsUpdate(document).length);
          return { status: 'skipped', reason: 'oversized' };
        }
        throw error;
      }
    };
    return contentLockAlreadyHeld ? flush() : options.withDocumentContentLock(documentName, flush);
  };
}
