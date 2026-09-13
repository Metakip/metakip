import {
  type ApplyContentBoundaryOperationCommand,
  type ApplyExactEditsCommand,
  applyContentBoundaryOperationCommandSchema,
  applyExactEditsCommandSchema,
  MAX_YDOC_BYTES,
  PageMarkdownError,
} from '@metakip/shared';

export class ContentCommandPayloadError extends Error {}

export function parseApplyExactEditsCommand(value: unknown): ApplyExactEditsCommand {
  const parsed = applyExactEditsCommandSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ContentCommandPayloadError(issue?.message ?? 'Invalid exact-edit command', {
    cause: parsed.error,
  });
}

export function parseApplyContentBoundaryOperationCommand(
  value: unknown,
): ApplyContentBoundaryOperationCommand {
  const parsed = applyContentBoundaryOperationCommandSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new ContentCommandPayloadError(issue?.message ?? 'Invalid content boundary operation', {
    cause: parsed.error,
  });
}

export async function readMarkdownCommandBody(request: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_YDOC_BYTES) {
      throw new PageMarkdownError(
        'document_too_large',
        `Markdown must be ${MAX_YDOC_BYTES} bytes or less`,
      );
    }
    chunks.push(buffer);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    // Raw request bytes are an external decoding boundary. Invalid UTF-8 is a
    // malformed command, so preserve the decoder failure as its cause.
    throw new ContentCommandPayloadError('Markdown must be valid UTF-8', { cause: error });
  }
}
