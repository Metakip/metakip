import { Readable } from 'node:stream';
import { MAX_YDOC_BYTES, PageMarkdownError } from '@metakip/shared';
import { describe, expect, it } from 'vitest';
import { readMarkdownCommandBody } from './internalContentCommandPayload';

describe('readMarkdownCommandBody', () => {
  it('accepts near-limit raw Markdown without JSON escaping overhead', async () => {
    const special = '"\\\n文';
    const specialBytes = Buffer.byteLength(special);
    const repeats = Math.floor((MAX_YDOC_BYTES - 7) / specialBytes);
    const markdown = special.repeat(repeats) + 'x'.repeat(MAX_YDOC_BYTES - repeats * specialBytes);

    expect(Buffer.byteLength(markdown)).toBe(MAX_YDOC_BYTES);
    await expect(readMarkdownCommandBody(Readable.from([Buffer.from(markdown)]))).resolves.toBe(
      markdown,
    );
  });

  it('rejects raw Markdown over the shared limit', async () => {
    const body = Readable.from([Buffer.alloc(MAX_YDOC_BYTES), Buffer.from('x')]);
    await expect(readMarkdownCommandBody(body)).rejects.toBeInstanceOf(PageMarkdownError);
  });

  it('rejects invalid UTF-8 instead of decoding replacement characters', async () => {
    await expect(
      readMarkdownCommandBody(Readable.from([Buffer.from([0xc3, 0x28])])),
    ).rejects.toThrow('Markdown must be valid UTF-8');
  });
});
