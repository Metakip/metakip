import { MAX_YDOC_BYTES } from '@metakip/shared';
import { HTTPException } from 'hono/http-exception';
import * as Y from 'yjs';

export const DOCUMENT_TOO_LARGE_CODE = 'DOCUMENT_TOO_LARGE';
export const INVALID_DOCUMENT_CODE = 'INVALID_DOCUMENT';

const documentTooLarge = () =>
  new HTTPException(413, {
    message: `Document must be ${MAX_YDOC_BYTES} bytes or less`,
    cause: {
      code: DOCUMENT_TOO_LARGE_CODE,
      maxBytes: MAX_YDOC_BYTES,
    },
  });

export function ensureDocumentInputSize(value: string | { size: number }): void {
  const size = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.size;
  if (size > MAX_YDOC_BYTES) throw documentTooLarge();
}

export function ensureYdocSize(value: Uint8Array | null): void {
  if (value && value.byteLength > MAX_YDOC_BYTES) throw documentTooLarge();
}

export function prepareCopiedYdoc(value: Uint8Array | null, title: string): Buffer | null {
  if (!value || value.byteLength === 0) return value ? Buffer.from(value) : null;
  ensureYdocSize(value);

  try {
    const document = new Y.Doc();
    Y.applyUpdate(document, value);
    if (document.store.pendingStructs !== null || document.store.pendingDs !== null) {
      throw new Error('Source document contains unresolved updates');
    }
    const titleText = document.getText('title');
    if (titleText.length > 0) titleText.delete(0, titleText.length);
    titleText.insert(0, title);
    const copied = Buffer.from(Y.encodeStateAsUpdate(document));
    ensureYdocSize(copied);
    return copied;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(422, {
      message: 'Source document is invalid',
      cause: { code: INVALID_DOCUMENT_CODE },
    });
  }
}
