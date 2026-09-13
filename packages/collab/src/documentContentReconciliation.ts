import type { Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import { COLLAB_DOCUMENT_RELOAD_REASONS } from '@metakip/shared';
import type { Pool } from 'pg';
import { getDocumentContentHash } from './documentContentHash';
import { isUuid } from './utils';

type StoredDocument = {
  id: string;
  ydoc: Buffer | null;
};

export async function reconcileActiveDocumentContent(options: {
  pool: Pool;
  hocuspocus: Hocuspocus;
  logger: Logger;
  isMetaRoom(documentName: string): boolean;
  getLoadedContentHash(documentName: string): string | undefined;
  withDocumentContentLock<T>(documentName: string, task: () => Promise<T>): Promise<T>;
  blockDocumentForReload(documentName: string, code: number, reason: string): void;
}): Promise<void> {
  const activePageIds = [...options.hocuspocus.documents.keys()].filter(
    (documentName) => !options.isMetaRoom(documentName) && isUuid(documentName),
  );
  if (activePageIds.length === 0) return;

  // Sample the loaded generations before the batch query. If a save advances
  // one while the query is running, its per-document lock observes the newer
  // generation and skips this stale snapshot. This avoids acquiring a global
  // lock across unrelated active documents.
  const sampledHashes = new Map(
    activePageIds.map((pageId) => [pageId, options.getLoadedContentHash(pageId)]),
  );
  const result = await options.pool.query<StoredDocument>(
    `select id, ydoc
     from pages
     where id = any($1::uuid[]) and is_deleted = false`,
    [activePageIds],
  );
  const storedById = new Map(result.rows.map((row) => [row.id, row.ydoc]));

  await Promise.all(
    activePageIds.map((pageId) =>
      options.withDocumentContentLock(pageId, async () => {
        const sampledHash = sampledHashes.get(pageId);
        const loadedHash = options.getLoadedContentHash(pageId);
        if (sampledHash === undefined || loadedHash !== sampledHash) return;
        const stored = storedById.get(pageId);
        if (stored === undefined) return;
        const storedHash = getDocumentContentHash(stored ? new Uint8Array(stored) : null);
        if (storedHash === loadedHash) return;

        options.logger.info(`[reconcile] reloading page=${pageId} after stored content changed`);
        options.blockDocumentForReload(
          pageId,
          4500,
          COLLAB_DOCUMENT_RELOAD_REASONS.RELOAD_REQUIRED,
        );
      }),
    ),
  );
}
