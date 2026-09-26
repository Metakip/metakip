import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { V1ImageUploadResponse } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { executeQuery } from '../db/query';
import {
  hasValidImageSignature,
  IMAGE_EXTENSION_BY_MIME,
  isSafeImageMime,
  MAX_IMAGE_SIZE_BYTES,
} from './image-upload';
import { ensurePageAccess, lockEntityAccess } from './share-access';
import type { PreparedUpload } from './uploadMaterialization';

export type UploadedImage = V1ImageUploadResponse;

export type ImageUploadInput = {
  content: Buffer;
  mimeType: string;
  originalName: string;
};

type UploadImageOptions = {
  alt?: string;
};

function markdownAlt(value: string): string {
  return value
    .replace(/[[\]\\]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function safeOriginalName(value: string, extension: string): string {
  return path.posix.basename(value.replace(/\\/g, '/')).trim() || `image.${extension}`;
}

export async function prepareImageUploadForPage(
  userId: string,
  pageId: string,
  image: ImageUploadInput,
  options: UploadImageOptions = {},
): Promise<PreparedUpload<UploadedImage>> {
  await ensurePageAccess(pageId, userId, 'edit');
  const { content, mimeType } = image;
  const size = content.byteLength;
  if (!isSafeImageMime(mimeType)) {
    throw new HTTPException(400, { message: 'Only JPEG, PNG, GIF, and WebP images are allowed' });
  }
  if (size > MAX_IMAGE_SIZE_BYTES) {
    throw new HTTPException(400, { message: 'File must be 10MB or less' });
  }
  if (!hasValidImageSignature(content, mimeType)) {
    throw new HTTPException(400, { message: 'File contents do not match the selected image type' });
  }
  const extension = IMAGE_EXTENSION_BY_MIME.get(mimeType);
  if (!extension) throw new HTTPException(400, { message: 'Unsupported image type' });

  const filename = `${randomUUID()}.${extension}`;
  const originalName = safeOriginalName(image.originalName, extension);
  return {
    content,
    contentType: mimeType,
    filename,
    persist: async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      await ensurePageAccess(pageId, userId, 'edit', tx);
      const uploadResult = await executeQuery<{ id: string }>(
        tx,
        sql`insert into uploads (filename, original_name, mime_type, size, uploaded_by)
              values (${filename}, ${originalName}, ${mimeType}, ${size}, ${userId})
              returning id`,
      );
      const id = uploadResult.rows[0]?.id;
      if (!id) throw new HTTPException(500, { message: 'Failed to create upload' });
      await executeQuery(
        tx,
        sql`insert into upload_page_refs (upload_id, page_id)
            values (${id}, ${pageId})
            on conflict (upload_id, page_id) do nothing`,
      );
      const url = `/api/uploads/${filename}`;
      const alt = markdownAlt(options.alt?.trim() || originalName);
      const response: UploadedImage = {
        id,
        url,
        markdown: `![${alt}](${url})`,
        filename,
        originalName,
        mimeType,
        size,
      };
      return response;
    },
  };
}
