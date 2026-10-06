import type {
  onChangePayload,
  onDisconnectPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import * as Y from 'yjs';
import {
  type CollabSession,
  isCollabSession,
  waitForPermissionChecks,
  waitForWriteApplications,
} from './collabSession';
import { getConnectionLifecycle, type WriteAdmission } from './connectionLifecycle';
import type { DocumentFlushResult } from './documentFlusher';
import type { PageTitleRuntime } from './pageTitleRuntime';

const MAX_DISCONNECT_PERSIST_ATTEMPTS = 3;

export function createDocumentChangeHooks(options: {
  logger: Logger;
  maxDocumentBytes: number;
  titles: PageTitleRuntime;
  isMetaRoom(documentName: string): boolean;
  isDocumentBlocked(documentName: string): boolean;
  getActiveDocument(documentName: string): Y.Doc | undefined;
  getDocumentSizeEstimate(documentName: string): number;
  setDocumentSizeEstimate(documentName: string, size: number): void;
  blockOversizedDocument(documentName: string, size: number): void;
  recordDocumentChange(
    documentName: string,
    context: CollabSession,
    admission: WriteAdmission | undefined,
  ): void;
  consumeAdmissionForUpdate(update: Uint8Array): WriteAdmission | undefined;
  resetDocumentState(documentName: string): void;
  flushDocument(
    documentName: string,
    document: Y.Doc,
    fallbackContext: CollabSession | undefined,
    source: 'persist' | 'disconnect',
  ): Promise<DocumentFlushResult>;
}) {
  return {
    onChange: async ({ documentName, context, document, update }: onChangePayload) => {
      if (options.isMetaRoom(documentName) || options.isDocumentBlocked(documentName)) return;
      const writer = isCollabSession(context) ? context : undefined;
      const exactAdmission = options.consumeAdmissionForUpdate(update);
      const admission =
        exactAdmission ??
        (writer ? getConnectionLifecycle(writer).pendingWriteAdmissions.shift() : undefined);
      if (!options.titles.ensureWithinLimit(documentName, document)) return;
      if (admission?.touchesTitle) {
        options.titles.setPendingBaseline(documentName, admission.titleRevision);
      }
      if (!writer) return;
      if (!admission && writer.permission !== 'edit' && writer.permission !== 'admin') return;

      const estimatedSize = options.getDocumentSizeEstimate(documentName) + update.byteLength;
      if (estimatedSize > options.maxDocumentBytes) {
        const encodedSize = Y.encodeStateAsUpdate(document).length;
        if (encodedSize > options.maxDocumentBytes) {
          options.blockOversizedDocument(documentName, encodedSize);
          return;
        }
        options.setDocumentSizeEstimate(documentName, encodedSize);
      } else {
        options.setDocumentSizeEstimate(documentName, estimatedSize);
      }
      options.recordDocumentChange(documentName, writer, admission);
    },
    onStoreDocument: async (data: onStoreDocumentPayload) => {
      const { documentName } = data;
      if (options.isDocumentBlocked(documentName)) return;
      if (options.isMetaRoom(documentName)) {
        options.logger.debug(`[meta] skip persist for meta room: ${documentName}`);
        return;
      }
      const context = isCollabSession(data.lastContext) ? data.lastContext : undefined;
      const isActiveDocument = options.getActiveDocument(documentName) === data.document;
      if (!isActiveDocument && !context) throw new Error('Unauthorized');
      const fallback = isActiveDocument ? undefined : context;
      try {
        await options.flushDocument(documentName, data.document, fallback, 'persist');
      } catch (error) {
        options.logger.error(`[persist] failed to save "${documentName}": ${error}`);
        throw error;
      }
    },
    afterUnloadDocument: async ({ documentName }: { documentName: string }) => {
      options.resetDocumentState(documentName);
      options.titles.clear(documentName);
    },
    onDisconnect: async ({ documentName, instance, context }: onDisconnectPayload) => {
      if (options.isMetaRoom(documentName) || options.isDocumentBlocked(documentName)) return;
      const session = isCollabSession(context) ? context : undefined;
      if (session) {
        await waitForPermissionChecks(session);
        await waitForWriteApplications(session);
      }
      await Promise.resolve();
      const document = instance.documents.get(documentName) as Y.Doc | undefined;
      if (!document) return;
      let attempt = 0;
      while (attempt < MAX_DISCONNECT_PERSIST_ATTEMPTS) {
        try {
          await options.flushDocument(documentName, document, undefined, 'disconnect');
          return;
        } catch (error) {
          attempt += 1;
          if (attempt === MAX_DISCONNECT_PERSIST_ATTEMPTS) {
            options.logger.error(
              `[disconnect] force save failed for "${documentName}" after ${attempt} attempts: ${error}`,
            );
            return;
          }
          const retryDelay = Math.min(100 * 2 ** (attempt - 1), 5_000);
          options.logger.error(
            `[disconnect] force save failed for "${documentName}"; retrying in ${retryDelay}ms: ${error}`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
    },
  };
}
