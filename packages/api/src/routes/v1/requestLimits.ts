import { MAX_INTERNAL_CONTENT_COMMAND_BYTES, MAX_YDOC_BYTES } from '@metakip/shared';
import { bodyLimit } from 'hono/body-limit';

const payloadTooLarge = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) =>
    c.json({ error: { code: 'payload_too_large', message: 'Request body is too large' } }, 413),
});

export const v1JsonBodyLimit = payloadTooLarge;

export const v1DocumentJsonBodyLimit = bodyLimit({
  maxSize: MAX_INTERNAL_CONTENT_COMMAND_BYTES,
  onError: (c) =>
    c.json({ error: { code: 'payload_too_large', message: 'Request body is too large' } }, 413),
});

export const v1MarkdownBodyLimit = bodyLimit({
  maxSize: MAX_YDOC_BYTES,
  onError: (c) =>
    c.json({ error: { code: 'payload_too_large', message: 'Request body is too large' } }, 413),
});
