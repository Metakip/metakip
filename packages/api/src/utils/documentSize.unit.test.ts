import { MAX_YDOC_BYTES } from '@metakip/shared';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DOCUMENT_TOO_LARGE_CODE,
  ensureDocumentInputSize,
  ensureYdocSize,
  INVALID_DOCUMENT_CODE,
  prepareCopiedYdoc,
} from './documentSize';

const expectDocumentTooLarge = (operation: () => void) => {
  try {
    operation();
    throw new Error('Expected document size validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    if (!(error instanceof HTTPException)) return;
    expect(error.status).toBe(413);
    expect(error.cause).toMatchObject({
      code: DOCUMENT_TOO_LARGE_CODE,
      maxBytes: MAX_YDOC_BYTES,
    });
  }
};

describe('document size validation', () => {
  it('accepts input and encoded state at the shared limit', () => {
    expect(() => ensureDocumentInputSize({ size: MAX_YDOC_BYTES })).not.toThrow();
    expect(() => ensureYdocSize(new Uint8Array(MAX_YDOC_BYTES))).not.toThrow();
  });

  it('rejects oversized input before parsing', () => {
    expectDocumentTooLarge(() => ensureDocumentInputSize({ size: MAX_YDOC_BYTES + 1 }));
  });

  it('rejects oversized encoded Yjs state', () => {
    expectDocumentTooLarge(() => ensureYdocSize(new Uint8Array(MAX_YDOC_BYTES + 1)));
  });

  it('rewrites the embedded title before copying a document', () => {
    const source = new Y.Doc();
    source.getText('title').insert(0, 'Original');

    const copied = prepareCopiedYdoc(Y.encodeStateAsUpdate(source), 'Copy of Original');
    const decoded = new Y.Doc();
    Y.applyUpdate(decoded, new Uint8Array(copied ?? []));

    expect(decoded.getText('title').toString()).toBe('Copy of Original');
  });

  it('preserves stable wiki-link targets when copying canonical state', () => {
    const targetId = '11111111-1111-1111-1111-111111111111';
    const source = new Y.Doc();
    source.getText('content').insert(0, `[[id:${targetId}]]`);

    const copied = prepareCopiedYdoc(Y.encodeStateAsUpdate(source), 'Copy');

    expect(copied).not.toBeNull();
    const copiedDocument = new Y.Doc();
    Y.applyUpdate(copiedDocument, new Uint8Array(copied ?? []));
    expect(copiedDocument.getText('content').toString()).toBe(`[[id:${targetId}]]`);
    expect(Buffer.from(copied ?? []).includes(Buffer.from(targetId))).toBe(true);
  });

  it('does not treat a target ID in another collaborative root as invalid content', () => {
    const targetId = '22222222-2222-2222-2222-222222222222';
    const source = new Y.Doc();
    const link = new Y.XmlElement('wikiLink');
    link.setAttribute('targetId', targetId);
    source.getXmlFragment('alternate').push([link]);

    expect(() => prepareCopiedYdoc(Y.encodeStateAsUpdate(source), 'Copy')).not.toThrow();
  });

  it('rejects malformed source documents instead of copying inaccessible state', () => {
    try {
      prepareCopiedYdoc(new Uint8Array([1, 2, 3]), 'Copy');
      throw new Error('Expected malformed document validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      if (!(error instanceof HTTPException)) return;
      expect(error.status).toBe(422);
      expect(error.cause).toMatchObject({ code: INVALID_DOCUMENT_CODE });
    }
  });
});
