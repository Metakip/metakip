import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  aggregateIndexedPageConnections,
  extractInlineTags,
  extractPropertyTagConnections,
  getFileExtension,
  getV1VaultImportKind,
  normalizeWikiLinkLookupKey,
  parseMarkdownFrontmatter,
} from '@metakip/shared';
import { bindWikiLinkTargets, markdownToYjsState } from '@metakip/shared/markdown-yjs';
import { type ConnectionDraft, normalizeTagSlug } from '@metakip/shared/yjs-helpers';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection';
import { executeQuery } from '../db/query';
import { ensureDocumentInputSize, ensureYdocSize } from './documentSize';
import { normalizeFolderName } from './folderName';
import {
  hasValidImageSignature,
  MAX_IMAGE_SIZE_BYTES,
  safeImageMimeForExtension,
} from './image-upload';
import { replacePageConnectionIndex, replacePageConnections } from './pageConnectionIndex';
import { normalizePageTitle } from './pageTitle';
import { getNextPosition } from './position';
import { lockWorkspaceAccess, lockWorkspaceAccessMutation } from './share-access';
import { notifyShareRecompute } from './share-notify';
import { getEntityMetaUserIds } from './shareRecipients';
import { materializeUploadFile } from './uploadMaterialization';
import { createVaultImportPlan } from './vaultImportPlan';
import type { VaultImportFile } from './vaultImportValidation';
import { getUniqueWorkspacePageLookup } from './wiki-link-lookup';

export type VaultFile = VaultImportFile;

export type ObsidianImportResult = {
  foldersCreated: number;
  pagesCreated: number;
  imagesUploaded: number;
  backlinksCreated: number;
  errors: string[];
};

const WIKILINK_REGEX = /(?<!!)\[\[([^#|\]]+)(?:#(\^[^|]+)|#([^|\]]+))?(?:\|([^\]]+))?\]\]/g;

type WikilinkMatch = {
  page: string;
  blockId: string | undefined;
  heading: string | undefined;
  alias: string | undefined;
  isEmbed: boolean;
};

const extractWikilinks = (content: string): WikilinkMatch[] => {
  const results: WikilinkMatch[] = [];
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec pattern
  while ((match = WIKILINK_REGEX.exec(content)) !== null) {
    const page = match[1];
    if (!page) continue;
    results.push({
      page: page.trim(),
      blockId: match[2]?.trim(),
      heading: match[3]?.trim(),
      alias: match[4]?.trim(),
      isEmbed: false,
    });
  }
  return results;
};

const extractEmbedLinks = (content: string): WikilinkMatch[] => {
  const embedRegex = /!\[\[([^#|\]]+)(?:#(\^[^|]+)|#([^|\]]+))?(?:\|([^\]]+))?\]\]/g;
  const results: WikilinkMatch[] = [];
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec pattern
  while ((match = embedRegex.exec(content)) !== null) {
    const page = match[1];
    if (!page) continue;
    results.push({
      page: page.trim(),
      blockId: match[2]?.trim(),
      heading: match[3]?.trim(),
      alias: match[4]?.trim(),
      isEmbed: true,
    });
  }
  return results;
};

const processMarkdownContent = (content: string, imageMap: Map<string, string>): string => {
  let result = content;

  result = result.replace(
    /!\[\[([^\]|]+(?:\.jpe?g|\.png|\.gif|\.webp|\.svg))(?:\|([^\]]+))?\]\]/gi,
    (_match, imagePath: string) => {
      const normalizedPath = imagePath.replace(/\\/g, '/').trim();
      const uploadedUrl = imageMap.get(normalizedPath);
      if (uploadedUrl) {
        return `![${path.basename(normalizedPath)}](${uploadedUrl})`;
      }
      return `![${path.basename(normalizedPath)}](${normalizedPath})`;
    },
  );

  result = result.replace(/!\[\[([^\]]+)\]\]/g, (_match, filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/').trim();
    return `[${path.basename(normalized)}](${normalized})`;
  });

  return result;
};

export async function importObsidianVault(
  userId: string,
  files: VaultFile[],
): Promise<ObsidianImportResult> {
  const result: ObsidianImportResult = {
    foldersCreated: 0,
    pagesCreated: 0,
    imagesUploaded: 0,
    backlinksCreated: 0,
    errors: [],
  };
  const plan = createVaultImportPlan(files);
  const { imageFiles, markdownFiles, unsupportedImageFiles } = plan;
  for (const file of unsupportedImageFiles) {
    result.errors.push(
      `Skipped unsupported image "${file.path}". Only JPEG, PNG, GIF, and WebP are allowed.`,
    );
  }

  const folderPathToId = new Map<string, string>();
  let notificationRoot: { entityType: 'folder' | 'page'; entityId: string } | null = null;
  const uniqueDirs = new Set<string>();

  for (const file of plan.files) {
    const dir = path.dirname(file.path);
    if (dir !== '.' && dir !== '/') {
      const parts = dir.split(/[\\/]/).filter(Boolean);
      let currentPath = '';
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        uniqueDirs.add(currentPath);
      }
    }
  }

  const sortedDirs = Array.from(uniqueDirs).sort((a, b) => {
    const depthA = a.split('/').length;
    const depthB = b.split('/').length;
    return depthA - depthB;
  });

  for (const dirPath of sortedDirs) {
    try {
      const parts = dirPath.split('/');
      const name = normalizeFolderName(parts[parts.length - 1] ?? '');
      const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
      const parentId = parentPath ? (folderPathToId.get(parentPath) ?? null) : null;
      if (parentPath && !parentId) {
        throw new Error(`Parent folder "${parentPath}" was not created`);
      }

      const insertResult = await db.transaction(async (tx) => {
        await lockWorkspaceAccessMutation(tx, userId);
        const nextPosition = await getNextPosition('folders', parentId, userId, tx);
        return executeQuery(
          tx,
          sql`insert into folders (parent_id, name, position, created_by) values (${parentId}, ${name}, ${nextPosition}, ${userId}) returning id`,
        );
      });

      if (insertResult.rowCount && insertResult.rowCount > 0) {
        const createdFolderId = insertResult.rows[0]?.id;
        if (typeof createdFolderId !== 'string') {
          throw new Error('Failed to create folder');
        }
        folderPathToId.set(dirPath, createdFolderId);
        notificationRoot ??= { entityType: 'folder', entityId: createdFolderId };
        result.foldersCreated++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to create folder "${dirPath}": ${message}`);
    }
  }

  const imagePathToURL = new Map<string, string>();
  const urlToUploadId = new Map<string, string>();
  for (const file of imageFiles) {
    try {
      if (!file.data || !file.mimeType) continue;

      const extension = getFileExtension(file.path);
      const expectedMime = safeImageMimeForExtension(extension);
      if (!expectedMime || file.mimeType !== expectedMime) {
        throw new Error('Unsupported image type');
      }

      const buffer = Buffer.from(file.data, 'base64');
      if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
        throw new Error('Image must be 10MB or less');
      }
      if (!hasValidImageSignature(buffer, expectedMime)) {
        throw new Error('File contents do not match the image type');
      }

      const filename = `${randomUUID()}.${extension === 'jpeg' ? 'jpg' : extension}`;
      const uploadId = await materializeUploadFile(
        filename,
        buffer,
        async (tx) => {
          const uploadResult = await executeQuery<{ id: string }>(
            tx,
            sql`insert into uploads (filename, original_name, mime_type, size, uploaded_by)
               values (${filename}, ${path.basename(file.path)}, ${expectedMime}, ${buffer.length}, ${userId})
               returning id`,
          );
          const id = uploadResult.rows[0]?.id;
          if (!id) throw new Error('Failed to create upload');
          return id;
        },
        { contentType: expectedMime },
      );

      const url = `/api/uploads/${filename}`;
      urlToUploadId.set(url, uploadId);
      imagePathToURL.set(file.path, url);
      imagePathToURL.set(path.basename(file.path), url);
      const parts = file.path.split('/');
      if (parts.length > 2) {
        const withoutRoot = parts.slice(1).join('/');
        imagePathToURL.set(withoutRoot, url);
      }
      result.imagesUploaded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to upload image "${file.path}": ${message}`);
    }
  }

  const pagePathToId = new Map<string, string>();
  const pageYdocs = new Map<string, Buffer>();

  for (const file of markdownFiles) {
    try {
      if (file.content === undefined) {
        throw new Error('Markdown content is required');
      }
      ensureDocumentInputSize(file.content);

      const { frontmatter, body } = parseMarkdownFrontmatter(file.content);
      const fileName = path.basename(file.path, path.extname(file.path));
      const title = normalizePageTitle(fileName);

      const dir = path.dirname(file.path);
      const normalizedDir = dir.replace(/\\/g, '/');
      const hasParentDirectory = dir !== '.' && dir !== '/';
      const parentId = hasParentDirectory ? (folderPathToId.get(normalizedDir) ?? null) : null;
      if (hasParentDirectory && !parentId) {
        throw new Error(`Parent folder "${normalizedDir}" was not created`);
      }

      const processedBody = processMarkdownContent(body, imagePathToURL);
      const ydocBuffer = Buffer.from(markdownToYjsState(processedBody));
      ensureYdocSize(ydocBuffer);
      const pageId = await db.transaction(async (tx) => {
        await lockWorkspaceAccessMutation(tx, userId);
        const nextPosition = await getNextPosition('pages', parentId, userId, tx);
        const insertResult = await executeQuery(
          tx,
          sql`insert into pages (parent_id, title, title_search, position, created_by, ydoc, properties)
           values (${parentId}, ${title}, to_tsvector('english', ${title}), ${nextPosition}, ${userId}, ${ydocBuffer}, ${JSON.stringify(frontmatter)}) returning *`,
        );
        const insertedPageId = insertResult.rows[0]?.id;
        if (typeof insertedPageId !== 'string') {
          throw new Error('Failed to create page');
        }

        for (const [url, uploadId] of urlToUploadId) {
          if (!processedBody.includes(url)) continue;
          await executeQuery(
            tx,
            sql`insert into upload_page_refs (upload_id, page_id)
             values (${uploadId}, ${insertedPageId})
             on conflict (upload_id, page_id) do nothing`,
          );
        }

        await replacePageConnectionIndex(tx, insertedPageId, ydocBuffer, frontmatter);
        return insertedPageId;
      });

      pagePathToId.set(file.path, pageId);
      pageYdocs.set(file.path, ydocBuffer);
      notificationRoot ??= { entityType: 'page', entityId: pageId };
      result.pagesCreated++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to create page "${file.path}": ${message}`);
    }
  }

  for (const file of markdownFiles) {
    const fileContent = file.content;
    if (fileContent === undefined) continue;
    const pageId = pagePathToId.get(file.path);
    const originalYdoc = pageYdocs.get(file.path);
    if (!pageId || !originalYdoc) continue;

    try {
      const backlinksCreated = await db.transaction(async (tx) => {
        await lockWorkspaceAccess(tx, userId);
        const pageResult = await executeQuery<{
          ydoc: Buffer | null;
          properties: Record<string, unknown> | null;
        }>(
          tx,
          sql`select ydoc, properties
           from pages
           where id = ${pageId} and is_deleted = false
           for update`,
        );
        const storedYdoc = pageResult.rows[0]?.ydoc;
        if (!storedYdoc) {
          throw new Error('Imported page is no longer active');
        }

        const workspacePageLookup = await getUniqueWorkspacePageLookup(userId, userId, tx);
        const currentYdoc = Buffer.from(storedYdoc);
        const pageWasEdited = !currentYdoc.equals(originalYdoc);
        let createdBacklinks = 0;

        if (!pageWasEdited) {
          const boundYdoc = Buffer.from(bindWikiLinkTargets(currentYdoc, workspacePageLookup));
          ensureYdocSize(boundYdoc);
          if (!boundYdoc.equals(currentYdoc)) {
            await executeQuery(
              tx,
              sql`update pages set ydoc = ${boundYdoc}, updated_at = now() where id = ${pageId}`,
            );
            await executeQuery(
              tx,
              sql`select pg_notify(${'page_content_replaced'}, ${JSON.stringify({ pageId })})`,
            );
          }
        }

        if (!pageWasEdited) {
          const wikilinks = extractWikilinks(fileContent);
          const embeds = extractEmbedLinks(fileContent);
          const allLinks = [...wikilinks, ...embeds];
          const connectionDrafts: ConnectionDraft[] = [
            ...extractPropertyTagConnections(pageResult.rows[0]?.properties ?? null),
            ...extractInlineTags(fileContent)
              .map(normalizeTagSlug)
              .filter((tag): tag is string => Boolean(tag))
              .map(
                (tag): ConnectionDraft => ({
                  targetType: 'tag',
                  targetSlug: tag,
                  targetLabel: tag,
                  connectionType: 'tag',
                  linkText: tag,
                }),
              ),
            ...allLinks.flatMap((link): ConnectionDraft[] => {
              if (link.isEmbed) {
                const kind = getV1VaultImportKind(link.page);
                if (kind === 'image' || kind === 'unsupported-image') return [];
              }
              const targetTitleLower = normalizeWikiLinkLookupKey(link.page);
              const targetPageId = workspacePageLookup.get(targetTitleLower);
              if (targetPageId) createdBacklinks += 1;
              return [
                {
                  targetType: 'page',
                  ...(targetPageId ? { targetId: targetPageId } : {}),
                  targetSlug: targetPageId ? `id:${targetPageId}` : targetTitleLower,
                  targetLabel: link.page,
                  connectionType: link.isEmbed ? 'embed' : link.heading ? 'heading' : 'wikilink',
                  linkText: link.alias || link.page,
                  linkContext: link.alias || link.page,
                },
              ];
            }),
          ];
          await replacePageConnections(
            tx,
            pageId,
            aggregateIndexedPageConnections(connectionDrafts),
          );
        }

        return createdBacklinks;
      });
      result.backlinksCreated += backlinksCreated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to resolve links for "${file.path}": ${message}`);
    }
  }

  if (notificationRoot) {
    await db.transaction(async (tx) => {
      await lockWorkspaceAccessMutation(tx, userId);
      const metaUserIds = await getEntityMetaUserIds(
        tx,
        notificationRoot.entityType,
        notificationRoot.entityId,
      );
      await notifyShareRecompute(
        {
          entityType: notificationRoot.entityType,
          entityId: notificationRoot.entityId,
          metaUserIds,
          metaOnly: true,
        },
        tx,
      );
    });
  }

  return result;
}
