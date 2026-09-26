import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { recordTokenAuditEventBestEffort, requireV1OperationScope } from '../../middleware/v1Auth';
import { MAX_IMAGE_SIZE_BYTES } from '../../utils/image-upload';
import {
  type ImageUploadInput,
  prepareImageUploadForPage,
  type UploadedImage,
} from '../../utils/imageUploadService';
import { parseIdempotencyKey } from './idempotency';
import { runIdempotentPreparedUpload } from './idempotentUpload';
import { imageUploadRequestSchema, pageOperations } from './pageContracts';
import { requireUuid } from './pageModel';
import { parseMultipartRequest } from './requestValidation';

const imageBodyLimit = bodyLimit({
  maxSize: MAX_IMAGE_SIZE_BYTES + 256 * 1024,
  onError: (c) =>
    c.json({ error: { code: 'payload_too_large', message: 'Request body is too large' } }, 413),
});

const pageImagesRoute = new Hono();

pageImagesRoute.post(
  pageOperations.uploadImage.routePath,
  requireV1OperationScope(pageOperations.uploadImage),
  imageBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const { file, alt } = await parseMultipartRequest(c, imageUploadRequestSchema);
    const key = parseIdempotencyKey(c.req.header('idempotency-key'));
    const image: ImageUploadInput = {
      content: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      originalName: file.name,
    };
    const requestHash = key
      ? createHash('sha256')
          .update(pageId)
          .update('\0')
          .update(image.originalName)
          .update('\0')
          .update(image.mimeType)
          .update('\0')
          .update(alt ?? '')
          .update('\0')
          .update(image.content)
          .digest('hex')
      : '';
    const uploaded = await runIdempotentPreparedUpload<UploadedImage>(
      principal,
      key,
      requestHash,
      () =>
        prepareImageUploadForPage(principal.userId, pageId, image, {
          ...(alt === undefined ? {} : { alt }),
        }),
    );
    await recordTokenAuditEventBestEffort(principal, 'image.upload', 'success', pageId);
    return c.json(uploaded, 201);
  },
);

export default pageImagesRoute;
