import {
  type MarkdownImportResult,
  type MarkdownImportWarning,
  parseMarkdownFrontmatter,
  UnsupportedMarkdownFrontmatterError,
} from '@metakip/shared';
import { bindWikiLinkTargets, createYjsDocWithTitle } from '@metakip/shared/markdown-yjs';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery } from '../db/query';
import { getDestinationOwnerId } from './destinationOwner';
import { ensureDocumentInputSize, ensureYdocSize } from './documentSize';
import { replacePageConnectionIndex } from './pageConnectionIndex';
import type { PageDatabaseRow } from './pageRows';
import { normalizePageTitle } from './pageTitle';
import { getNextPosition } from './position';
import {
  ensureFolderAccess,
  lockEntityAccessMutation,
  lockWorkspaceAccessMutation,
} from './share-access';
import { notifyShareRecompute } from './share-notify';
import { getEntityMetaUserIds } from './shareRecipients';
import { getUniqueWorkspacePageLookup } from './wiki-link-lookup';

const isLocalImageReference = (reference: string): boolean => {
  const value = reference.trim();
  return !/^(?:https?:)?\/\//i.test(value) && !/^(?:data|blob):/i.test(value);
};

const countLocalImageReferences = (content: string): number => {
  const references: string[] = [];

  for (const match of content.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)) {
    const reference = match[1] ?? match[2];
    if (reference) references.push(reference);
  }

  for (const match of content.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi,
  )) {
    const reference = match[1] ?? match[2] ?? match[3];
    if (reference) references.push(reference);
  }

  for (const match of content.matchAll(
    /!\[\[([^\]|#]+\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp))(?:[|#][^\]]*)?\]\]/gi,
  )) {
    const reference = match[1];
    if (reference) references.push(reference);
  }

  return references.filter(isLocalImageReference).length;
};

export async function importMarkdownPage(
  userId: string,
  parentId: string | null,
  filename: string,
  content: string,
): Promise<MarkdownImportResult> {
  ensureDocumentInputSize(content);
  if (parentId) await ensureFolderAccess(parentId, userId, 'admin');

  let parsedMarkdown: ReturnType<typeof parseMarkdownFrontmatter>;
  try {
    parsedMarkdown = parseMarkdownFrontmatter(content);
  } catch (error) {
    if (error instanceof UnsupportedMarkdownFrontmatterError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  }
  const { body, frontmatter: properties } = parsedMarkdown;
  const title = normalizePageTitle(filename.replace(/\.md$/i, ''));

  const localImageCount = countLocalImageReferences(body);
  const unresolvedYdocBuffer = Buffer.from(createYjsDocWithTitle(title, body));
  ensureYdocSize(unresolvedYdocBuffer);

  const hasProperties = Object.keys(properties).length > 0;
  const insertResult = await db.transaction(async (tx) => {
    if (parentId) {
      await lockEntityAccessMutation(tx, 'folder', parentId);
      await ensureFolderAccess(parentId, userId, 'admin', tx);
    } else {
      await lockWorkspaceAccessMutation(tx, userId);
    }

    const ownerId = await getDestinationOwnerId(tx, parentId, userId);
    if (!ownerId) throw new HTTPException(404, { message: 'Parent folder not found' });
    const pageLookup = await getUniqueWorkspacePageLookup(ownerId, userId, tx);
    const ydocBuffer = Buffer.from(bindWikiLinkTargets(unresolvedYdocBuffer, pageLookup));
    ensureYdocSize(ydocBuffer);

    const nextPosition = await getNextPosition('pages', parentId, userId, tx);
    const result = hasProperties
      ? await executeQuery<PageDatabaseRow>(
          tx,
          sql`insert into pages (parent_id, title, title_search, position, created_by, ydoc, properties) values (${parentId}, ${title}, to_tsvector('english', ${title}), ${nextPosition}, ${userId}, ${ydocBuffer}, ${JSON.stringify(properties)}) returning *`,
        )
      : await executeQuery<PageDatabaseRow>(
          tx,
          sql`insert into pages (parent_id, title, title_search, position, created_by, ydoc) values (${parentId}, ${title}, to_tsvector('english', ${title}), ${nextPosition}, ${userId}, ${ydocBuffer}) returning *`,
        );
    const createdPageId = result.rows[0]?.id;
    if (createdPageId) {
      await replacePageConnectionIndex(tx, createdPageId, ydocBuffer, properties);
      const metaUserIds = await getEntityMetaUserIds(tx, 'page', createdPageId);
      await notifyShareRecompute(
        {
          entityType: 'page',
          entityId: createdPageId,
          metaUserIds,
          metaOnly: true,
        },
        tx,
      );
    }
    return result;
  });

  if (insertResult.rowCount === 0) {
    throw new HTTPException(500, { message: 'Failed to create page' });
  }

  const createdRow = insertResult.rows[0];
  if (!createdRow) throw new HTTPException(500, { message: 'Failed to create page' });
  const warnings: MarkdownImportWarning[] = [];
  if (localImageCount > 0) {
    warnings.push({
      code: 'LOCAL_IMAGES_NOT_IMPORTED',
      count: localImageCount,
      message: `${localImageCount} local image${localImageCount === 1 ? ' was' : 's were'} not included. Import the folder as an Obsidian vault to include attachments.`,
    });
  }
  return {
    page: { id: createdRow.id, title: createdRow.title },
    warnings,
  } satisfies MarkdownImportResult;
}
