import { extractWikiLinkTargetIds } from '@metakip/shared/yjs-helpers';
import { sql } from 'drizzle-orm';
import JSZip from 'jszip';
import { query } from '../db/query';
import { uploadsDir } from '../env';
import { extractImages, pageToMarkdown } from './export-helpers';
import { allocateFilename } from './filename';

type PageExportRow = {
  id: string;
  ownerId: string;
  title: string | null;
  ydoc: Buffer | null;
  properties: Record<string, unknown> | null;
  icon: string | null;
  uploadFilenames: string[];
};

export async function exportAllPages(userId: string): Promise<Buffer> {
  const result = await query(
    sql`
      select p.id,
        coalesce(get_root_folder_owner(p.parent_id), p.created_by) as "ownerId",
        p.title, p.ydoc, p.properties, p.icon,
        coalesce(
          (
            select array_agg(u.filename)
            from upload_page_refs upr
            join uploads u on u.id = upr.upload_id
            where upr.page_id = p.id
          ),
          '{}'::text[]
        ) as "uploadFilenames"
      from pages p
      where p.is_deleted = false
        and p.id in (select page_id from get_accessible_page_ids(${userId}))
      order by p.parent_id nulls first, p.position::numeric asc
    `,
  );

  const pages = result.rows as PageExportRow[];
  const targetIds = [
    ...new Set(
      pages.flatMap((page) =>
        page.ydoc
          ? extractWikiLinkTargetIds(new Uint8Array(page.ydoc)).filter((targetId) =>
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId),
            )
          : [],
      ),
    ),
  ];
  const exportTargets = new Map<string, { title: string; ownerId: string }>();
  if (targetIds.length > 0) {
    const targets = await query<{ id: string; title: string; ownerId: string }>(
      sql`select p.id, p.title,
              coalesce(get_root_folder_owner(p.parent_id), p.created_by) as "ownerId"
       from pages p
       where p.id = any(${sql.param(targetIds)}::uuid[])
         and p.is_deleted = false
         and p.id in (select page_id from get_accessible_page_ids(${userId}))`,
    );
    for (const target of targets.rows) exportTargets.set(target.id, target);
  }
  const zip = new JSZip();
  const usedNames = new Set<string>();
  const allAssets = new Map<string, Buffer>();

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page) continue;
    const title =
      typeof page.title === 'string' && page.title.trim().length > 0
        ? page.title.trim()
        : 'Untitled';
    const filename = allocateFilename(title, '.md', usedNames, `Untitled ${i + 1}`);

    let content = pageToMarkdown(page.ydoc, page.properties, page.icon, {
      resolveWikiLinkTarget: (targetId) => {
        const target = exportTargets.get(targetId.toLowerCase());
        return target?.ownerId === page.ownerId ? { title: target.title } : null;
      },
      restrictedWikiLinkText: 'Restricted page',
    });
    const extracted = await extractImages(content, uploadsDir, new Set(page.uploadFilenames));
    content = extracted.markdown;

    for (const [assetName, assetBuffer] of extracted.assets) {
      if (!allAssets.has(assetName)) {
        allAssets.set(assetName, assetBuffer);
      }
    }

    zip.file(filename, content);
  }

  for (const [assetName, assetBuffer] of allAssets) {
    zip.file(`assets/${assetName}`, assetBuffer);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}
