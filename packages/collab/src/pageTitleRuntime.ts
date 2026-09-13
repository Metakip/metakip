import type { Document, Hocuspocus } from '@hocuspocus/server';
import type { Logger } from '@logtape/logtape';
import {
  COLLAB_DOCUMENT_RELOAD_REASONS,
  getUnicodeCodePointLength,
  MAX_PAGE_TITLE_LENGTH,
} from '@metakip/shared';
import type { Pool } from 'pg';
import type * as Y from 'yjs';
import { SKIP_STORE_LOCAL_ORIGIN } from './hocuspocusTransactionOrigins';

type PageTitleRuntimeOptions = {
  pool: Pool;
  logger: Logger;
  getHocuspocus(): Hocuspocus;
  blockDocument(documentName: string, code: number, reason: string): void;
};

export type PageTitleRuntime = ReturnType<typeof createPageTitleRuntime>;

export function createPageTitleRuntime({
  pool,
  logger,
  getHocuspocus,
  blockDocument,
}: PageTitleRuntimeOptions) {
  const accepted = new Map<string, string>();
  const canonical = new Map<string, string>();
  const pendingBaselines = new Map<string, string>();

  function clear(documentName: string): void {
    accepted.delete(documentName);
    canonical.delete(documentName);
    pendingBaselines.delete(documentName);
  }

  function rememberLoaded(documentName: string, title: string): void {
    accepted.set(documentName, title);
    canonical.set(documentName, title);
    pendingBaselines.delete(documentName);
  }

  function rememberPersisted(documentName: string, title: string): void {
    canonical.set(documentName, title);
    accepted.set(documentName, title);
    pendingBaselines.delete(documentName);
  }

  function rememberExternal(documentName: string, title: string, preservePending: boolean): void {
    canonical.set(documentName, title);
    if (preservePending) return;
    accepted.set(documentName, title);
    pendingBaselines.delete(documentName);
  }

  function ensureWithinLimit(documentName: string, document: Y.Doc): boolean {
    if (!document.share.has('title')) return true;
    const titleText = document.getText('title');
    const title = titleText.toString();
    const titleLength = getUnicodeCodePointLength(title);
    if (titleLength <= MAX_PAGE_TITLE_LENGTH) {
      if (title.length > 0) accepted.set(documentName, title);
      return true;
    }
    const acceptedTitle = accepted.get(documentName);
    if (acceptedTitle === title) return true;
    if (acceptedTitle === undefined) {
      logger.error(`[title] cannot recover page=${documentName}: no canonical title is available`);
      blockDocument(documentName, 4500, COLLAB_DOCUMENT_RELOAD_REASONS.RELOAD_REQUIRED);
      return false;
    }
    document.transact(() => {
      titleText.delete(0, titleText.length);
      titleText.insert(0, acceptedTitle);
    }, SKIP_STORE_LOCAL_ORIGIN);
    logger.warn(
      `[title] rejected page=${documentName}: title is ${titleLength} characters (limit ${MAX_PAGE_TITLE_LENGTH})`,
    );
    return true;
  }

  async function reconcileActive(): Promise<void> {
    const pageIds = Array.from(getHocuspocus().documents.keys()).filter((name) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name),
    );
    for (const pageId of pageIds) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const owner = await client.query<{ owner_id: string | null }>(
          `select coalesce(get_root_folder_owner(parent_id), created_by) as owner_id
           from pages where id = $1 and is_deleted = false`,
          [pageId],
        );
        const ownerId = owner.rows[0]?.owner_id;
        if (!ownerId) {
          await client.query('rollback');
          continue;
        }
        await client.query('select pg_advisory_xact_lock_shared(hashtextextended($1, 0))', [
          `workspace-access:${ownerId}`,
        ]);
        const result = await client.query<{ title: string; title_revision: string }>(
          `select title, title_revision::text as title_revision
           from pages where id = $1 and is_deleted = false for update`,
          [pageId],
        );
        const row = result.rows[0];
        const document = getHocuspocus().documents.get(pageId) as Document | undefined;
        if (!row || !document) {
          await client.query('rollback');
          continue;
        }
        const title = document.getText('title');
        const previousCanonical = canonical.get(pageId);
        if (previousCanonical !== undefined && previousCanonical !== row.title) {
          const preserveCollaborativeTitle =
            title.toString() !== previousCanonical &&
            pendingBaselines.get(pageId) === row.title_revision;
          if (!preserveCollaborativeTitle && title.toString() !== row.title) {
            document.transact(() => {
              title.delete(0, title.length);
              title.insert(0, row.title);
            }, SKIP_STORE_LOCAL_ORIGIN);
            accepted.set(pageId, row.title);
            pendingBaselines.delete(pageId);
          }
          canonical.set(pageId, row.title);
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  }

  return {
    clear,
    ensureWithinLimit,
    getCanonical: (documentName: string) => canonical.get(documentName),
    getPendingBaseline: (documentName: string) => pendingBaselines.get(documentName),
    reconcileActive,
    rememberExternal,
    rememberLoaded,
    rememberPersisted,
    restorePendingBaseline(documentName: string, expected: string, previous: string | undefined) {
      if (pendingBaselines.get(documentName) !== expected) return;
      if (previous === undefined) pendingBaselines.delete(documentName);
      else pendingBaselines.set(documentName, previous);
    },
    setPendingBaseline: (documentName: string, revision: string) =>
      pendingBaselines.set(documentName, revision),
  };
}
