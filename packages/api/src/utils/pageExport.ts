import { extractWikiLinkTargetIds } from '@metakip/shared/yjs-helpers';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import JSZip from 'jszip';
import { db } from '../db/connection';
import { executeQuery } from '../db/query';
import { uploadsDir } from '../env';
import { extractImages, pageToMarkdown } from './export-helpers';
import { allocateFilename, attachmentContentDisposition } from './filename';
import { getPageById } from './pageRepository';
import { ensurePageAccess, lockEntityAccess } from './share-access';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PageExport = {
  body: Buffer | string;
  contentType: 'application/zip' | 'text/markdown';
  contentDisposition: string;
};

export async function exportPageForUser(pageId: string, userId: string): Promise<PageExport> {
  const snapshot = await db.transaction(async (tx) => {
    await lockEntityAccess(tx, 'page', pageId);
    const page = await getPageById(pageId, tx);
    if (!page) {
      throw new HTTPException(404, { message: 'Page not found' });
    }
    await ensurePageAccess(page.id, userId, 'view', tx);
    const uploadResult = await executeQuery<{ filename: string }>(
      tx,
      sql`select u.filename
       from uploads u
       join upload_page_refs upr on upr.upload_id = u.id
       where upr.page_id = ${pageId}`,
    );
    const targetIds = page.ydoc
      ? extractWikiLinkTargetIds(new Uint8Array(page.ydoc)).filter((targetId) =>
          UUID_PATTERN.test(targetId),
        )
      : [];
    const ownerId =
      page.ownerId ??
      (
        await executeQuery<{ owner_id: string | null }>(
          tx,
          sql`select coalesce(get_root_folder_owner(parent_id), created_by) as owner_id
           from pages where id = ${pageId}`,
        )
      ).rows[0]?.owner_id;
    if (!ownerId) throw new HTTPException(404, { message: 'Page not found' });
    const targetResult =
      targetIds.length > 0
        ? await executeQuery<{ id: string; title: string }>(
            tx,
            sql`select p.id, p.title
             from pages p
             where p.id = any(${sql.param(targetIds)}::uuid[])
               and p.is_deleted = false
               and p.id in (select page_id from get_accessible_page_ids(${userId}))
               and coalesce(get_root_folder_owner(p.parent_id), p.created_by) = ${ownerId}`,
          )
        : { rows: [] };
    return {
      page,
      authorizedUploadFilenames: new Set(uploadResult.rows.map((row) => row.filename)),
      wikiLinkTargets: new Map(targetResult.rows.map((target) => [target.id, target.title])),
    };
  });

  const { page, authorizedUploadFilenames, wikiLinkTargets } = snapshot;
  const markdownFilename = allocateFilename(page.title || 'Untitled', '.md', new Set());
  const markdown = pageToMarkdown(page.ydoc, page.properties, page.icon, {
    resolveWikiLinkTarget: (targetId) => {
      const title = wikiLinkTargets.get(targetId.toLowerCase());
      return title ? { title } : null;
    },
    restrictedWikiLinkText: 'Restricted page',
  });
  const extracted = await extractImages(markdown, uploadsDir, authorizedUploadFilenames);

  if (extracted.assets.size === 0) {
    return {
      body: extracted.markdown,
      contentType: 'text/markdown',
      contentDisposition: attachmentContentDisposition(markdownFilename),
    };
  }

  const zip = new JSZip();
  zip.file(markdownFilename, extracted.markdown);
  for (const [assetName, assetBuffer] of extracted.assets) {
    zip.file(`assets/${assetName}`, assetBuffer);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const zipFilename = allocateFilename(page.title || 'Untitled', '.zip', new Set());
  return {
    body: buffer,
    contentType: 'application/zip',
    contentDisposition: attachmentContentDisposition(zipFilename),
  };
}
