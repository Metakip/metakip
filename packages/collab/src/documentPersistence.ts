import type { Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import type { Pool, PoolClient } from 'pg';
import * as Y from 'yjs';
import { sanitizeCanonicalYjsUpdate } from './collaborationProtocol';
import { type ConnectionResolutionPrincipal, updateConnections } from './connectionIndex';
import {
  type DocumentPersistenceMutation,
  matchesContentMetadataRevision,
  persistContentCommandEffects,
} from './contentMutationPersistence';
import { getDocumentContentHash } from './documentContentHash';
import { DocumentSizeLimitError } from './documentSizeError';
import { SKIP_STORE_LOCAL_ORIGIN } from './hocuspocusTransactionOrigins';
import {
  getActiveMetaDocuments,
  getPageMetaRecipients,
  type PageMeta,
  updateBacklinksVersion,
  updatePageMeta,
} from './pageMetadata';
import { broadcastWikiLinkPresentationInvalidation } from './wikiLinkInvalidation';

export type PersistDocumentResult =
  | { committed: false; staleContent?: boolean }
  | {
      committed: true;
      canonicalTitle: string;
      contentHash: string;
      state: Uint8Array;
      stateSize: number;
    };

export type PersistDocumentOptions = {
  pool: Pool;
  hocuspocus: Hocuspocus;
  documentName: string;
  document: Y.Doc;
  connectionSnapshotState: Uint8Array;
  connectionResolutionPrincipals: ConnectionResolutionPrincipal[];
  lastCanonicalTitle: string | undefined;
  getPendingTitleBaseline: () => string | undefined;
  maxDocumentBytes: number;
  logger: Logger;
  authorizePersistence?: (client: PoolClient) => Promise<boolean>;
  expectedContentHash: string | undefined;
  mutation?: DocumentPersistenceMutation;
};
export type { DocumentPersistenceMutation } from './contentMutationPersistence';

function extractTitle(document: Y.Doc): string {
  return document.getText('title').toString() || 'Untitled';
}

export async function persistDocument(
  options: PersistDocumentOptions,
  attempt = 1,
): Promise<PersistDocumentResult> {
  const {
    pool,
    hocuspocus,
    documentName,
    document,
    connectionSnapshotState,
    connectionResolutionPrincipals,
    lastCanonicalTitle,
    getPendingTitleBaseline,
    maxDocumentBytes,
    logger,
    authorizePersistence,
    expectedContentHash,
    mutation,
  } = options;
  const client = await pool.connect();
  let targetPageIds: string[] = [];
  let pageMeta: PageMeta | undefined;
  let committedStateSize = 0;
  let committedState: Uint8Array = new Uint8Array();
  let committedContentHash = getDocumentContentHash(null);
  let committedTitle = lastCanonicalTitle ?? 'Untitled';
  let committedWhileDeleted = false;
  let wikiLinkPresentationsChanged = false;

  try {
    await client.query('BEGIN');
    if (authorizePersistence && !(await authorizePersistence(client))) {
      await client.query('ROLLBACK');
      return { committed: false };
    }

    const currentResult = await client.query<{
      ydoc: Buffer | null;
      title: string;
      icon: string | null;
      properties: Record<string, unknown> | null;
      is_deleted: boolean;
      title_revision: string;
    }>(
      `select ydoc, title, icon, properties, is_deleted, title_revision::text as title_revision
       from pages where id = $1 for update`,
      [documentName],
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      return { committed: false };
    }
    if (
      expectedContentHash !== undefined &&
      getDocumentContentHash(current.ydoc ? new Uint8Array(current.ydoc) : null) !==
        expectedContentHash
    ) {
      await client.query('ROLLBACK');
      return { committed: false, staleContent: true };
    }
    if (
      mutation &&
      !matchesContentMetadataRevision(
        { properties: current.properties, icon: current.icon },
        mutation,
      )
    ) {
      await client.query('ROLLBACK');
      return { committed: false, staleContent: true };
    }

    const connectionSnapshot = new Y.Doc();
    let connectionState: Uint8Array;
    try {
      Y.applyUpdate(connectionSnapshot, connectionSnapshotState);
      if (current.ydoc && current.ydoc.length > 0) {
        const canonicalCurrentState = sanitizeCanonicalYjsUpdate(new Uint8Array(current.ydoc));
        Y.applyUpdate(document, canonicalCurrentState, SKIP_STORE_LOCAL_ORIGIN);
        Y.applyUpdate(connectionSnapshot, canonicalCurrentState);
      }
      connectionState = Y.encodeStateAsUpdate(connectionSnapshot);
    } finally {
      connectionSnapshot.destroy();
    }

    const externalRenameWins =
      lastCanonicalTitle !== undefined &&
      current.title !== lastCanonicalTitle &&
      getPendingTitleBaseline() !== current.title_revision;
    if (externalRenameWins) {
      document.transact(() => {
        const titleText = document.getText('title');
        titleText.delete(0, titleText.length);
        titleText.insert(0, current.title);
      }, SKIP_STORE_LOCAL_ORIGIN);
    }

    const persistedTitle = {
      fieldExisted: document.share.has('title'),
      value: extractTitle(document),
    };
    const state = Y.encodeStateAsUpdate(document);
    if (state.length > maxDocumentBytes) throw new DocumentSizeLimitError();

    if (current.is_deleted) {
      const hasMeaningfulTitle = persistedTitle.fieldExisted && persistedTitle.value !== 'Untitled';
      if (hasMeaningfulTitle) {
        await client.query(
          `update pages
           set ydoc = $1,
               title_revision = title_revision + case when title is distinct from $2 then 1 else 0 end,
               title = $2, updated_at = now()
           where id = $3 and is_deleted = true`,
          [state, persistedTitle.value, documentName],
        );
        committedTitle = persistedTitle.value;
      } else {
        await client.query(
          'update pages set ydoc = $1, updated_at = now() where id = $2 and is_deleted = true',
          [state, documentName],
        );
        committedTitle = current.title;
      }
      committedWhileDeleted = true;
    } else if (persistedTitle.fieldExisted) {
      if (persistedTitle.value !== 'Untitled') {
        await client.query(
          `update pages
           set ydoc = $1,
               title_revision = title_revision + case when title is distinct from $2 then 1 else 0 end,
               title = $2, updated_at = now()
           where id = $3`,
          [state, persistedTitle.value, documentName],
        );
      } else {
        await client.query('update pages set ydoc = $1, updated_at = now() where id = $2', [
          state,
          documentName,
        ]);
      }
    } else {
      await client.query('update pages set ydoc = $1, updated_at = now() where id = $2', [
        state,
        documentName,
      ]);
    }

    if (!committedWhileDeleted && mutation) {
      mutation.prepareCommittedState?.(state);
      await persistContentCommandEffects(client, documentName, mutation);
    }

    if (!committedWhileDeleted) {
      targetPageIds = await updateConnections(
        client,
        documentName,
        connectionState,
        connectionResolutionPrincipals,
        logger,
      );
      const metaResult = await client.query<PageMeta>(
        'select title, icon, parent_id, position from pages where id = $1',
        [documentName],
      );
      pageMeta = metaResult.rows[0];
    }

    await client.query('COMMIT');
    committedState = state;
    committedStateSize = state.length;
    committedContentHash = getDocumentContentHash(state);
    committedTitle = pageMeta?.title ?? committedTitle ?? current.title;
    wikiLinkPresentationsChanged = !committedWhileDeleted && committedTitle !== current.title;
  } catch (error) {
    await client.query('ROLLBACK');
    const postgresError = error as { code?: string } | undefined;
    if (postgresError?.code === '40P01' && attempt < 3) {
      logger.warn(`[persist] deadlock on page ${documentName}, retrying (attempt ${attempt})`);
      await new Promise((resolve) => setTimeout(resolve, Math.min(50 * 2 ** attempt, 500)));
      return persistDocument(options, attempt + 1);
    }
    logger.error(`[persist] failed for page ${documentName}: ${error}`);
    throw error;
  } finally {
    client.release();
  }

  if (committedWhileDeleted) {
    return {
      committed: true,
      canonicalTitle: committedTitle,
      contentHash: committedContentHash,
      state: committedState,
      stateSize: committedStateSize,
    };
  }
  if (wikiLinkPresentationsChanged) {
    try {
      await broadcastWikiLinkPresentationInvalidation(hocuspocus, pool, {
        targetPageIds: [documentName],
      });
    } catch (error) {
      logger.error(
        `[persist] wiki-link invalidation failed after title commit for page=${documentName}: ${error}`,
      );
    }
  }

  const activeDocuments = getActiveMetaDocuments(hocuspocus);
  if (activeDocuments.size === 0) {
    return {
      committed: true,
      canonicalTitle: committedTitle,
      contentHash: committedContentHash,
      state: committedState,
      stateSize: committedStateSize,
    };
  }
  try {
    const affectedIds = [...new Set([documentName, ...targetPageIds])];
    const recipients = await getPageMetaRecipients(
      pool,
      affectedIds,
      Array.from(activeDocuments.keys()),
    );
    const results = await Promise.allSettled([
      updatePageMeta(hocuspocus, pool, documentName, logger, {
        ...(pageMeta ? { page: pageMeta } : {}),
        recipients,
        activeDocuments,
      }),
      updateBacklinksVersion(hocuspocus, pool, affectedIds, logger, {
        recipients,
        activeDocuments,
      }),
    ]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason as unknown);
    if (failures.length > 0) {
      throw new AggregateError(failures, `Failed to publish metadata for ${documentName}`);
    }
  } catch (error) {
    logger.error(
      `[persist] metadata publication failed after commit for page=${documentName}: ${error}`,
    );
  }
  return {
    committed: true,
    canonicalTitle: committedTitle,
    contentHash: committedContentHash,
    state: committedState,
    stateSize: committedStateSize,
  };
}
