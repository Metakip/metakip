import { randomUUID } from 'node:crypto';
import {
  type ApplyContentBoundaryOperationCommand,
  type ApplyExactEditsCommand,
  applyContentBoundaryOperationCommandSchema,
  applyExactEditsCommandSchema,
  type ContentBoundaryOperationResponse,
  contentBoundaryOperationResponseSchema,
  type ExactEditCommandResponse,
  exactEditCommandResponseSchema,
  INTERNAL_CONTENT_HEADERS,
  type InternalContentPrincipal,
  internalContentErrorResponseSchema,
  MAX_INTERNAL_CONTENT_COMMAND_BYTES,
  type ReadPageMarkdownCommandResponse,
  type ReplacePageMarkdownCommandResponse,
  readPageMarkdownCommandResponseSchema,
  replacePageMarkdownCommandResponseSchema,
} from '@metakip/shared';
import { HTTPException } from 'hono/http-exception';
import type { ZodType } from 'zod';
import { requireCollaborationInternalSecret } from '../env';
import { type V1Principal, v1IdempotencyPrincipal } from '../middleware/v1Auth';

const CONNECT_TIMEOUT_MS = 10_000;

async function readInternalBody(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error('Collaboration response body is missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_INTERNAL_CONTENT_COMMAND_BYTES) {
        await reader.cancel('Collaboration response exceeds the command size limit');
        throw new Error('Collaboration response exceeds the command size limit');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readInternalJson(response: Response): Promise<unknown> {
  const json = new TextDecoder('utf-8', { fatal: true }).decode(await readInternalBody(response));
  return JSON.parse(json) as unknown;
}

async function readInternalMarkdown(response: Response): Promise<unknown> {
  if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/markdown')) {
    throw new Error('Collaboration Markdown response has an invalid content type');
  }
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(
    await readInternalBody(response),
  );
  return { markdown, etag: response.headers.get('ETag') };
}

function collaborationUrl(): string {
  const configured = process.env.COLLAB_INTERNAL_URL;
  if (configured) {
    const url = new URL(configured);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.protocol === 'wss:') url.protocol = 'https:';
    return url.toString().replace(/\/$/, '');
  }
  return `http://127.0.0.1:${process.env.COLLAB_PORT ?? '1234'}`;
}

function internalPrincipal(principal: V1Principal): InternalContentPrincipal {
  return {
    userId: principal.userId,
    requestId: randomUUID(),
    tokenId: principal.kind === 'token' ? principal.tokenId : null,
    idempotencyPrincipal: v1IdempotencyPrincipal(principal),
  };
}

async function postInternal(
  path: string,
  principal: V1Principal,
  options: {
    requestBody?: { contentType: string; value: string; headers?: Record<string, string> };
    successFormat?: 'json' | 'markdown';
  } = {},
): Promise<unknown> {
  const trustedPrincipal = internalPrincipal(principal);
  const requestBody = options.requestBody;
  let response: Response;
  try {
    response = await fetch(`${collaborationUrl()}${path}`, {
      method: 'POST',
      headers: {
        [INTERNAL_CONTENT_HEADERS.secret]: requireCollaborationInternalSecret(),
        [INTERNAL_CONTENT_HEADERS.userId]: trustedPrincipal.userId,
        [INTERNAL_CONTENT_HEADERS.requestId]: trustedPrincipal.requestId,
        [INTERNAL_CONTENT_HEADERS.idempotencyPrincipal]: trustedPrincipal.idempotencyPrincipal,
        ...(trustedPrincipal.tokenId
          ? { [INTERNAL_CONTENT_HEADERS.tokenId]: trustedPrincipal.tokenId }
          : {}),
        ...(requestBody ? { 'Content-Type': requestBody.contentType, ...requestBody.headers } : {}),
      },
      ...(requestBody ? { body: requestBody.value } : {}),
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
  } catch (error) {
    // DNS, timeout, connection, and response-loss failures are uncertain at
    // this private HTTP boundary. Surface 503 so idempotent callers retain
    // their reservation and can safely replay it.
    throw new HTTPException(503, {
      message: 'Collaboration service is unavailable',
      cause: { code: 'COLLABORATION_FAILURE', error },
    });
  }
  let responseBody: unknown;
  try {
    responseBody =
      response.ok && options.successFormat === 'markdown'
        ? await readInternalMarkdown(response)
        : await readInternalJson(response);
  } catch (error) {
    // This is the private HTTP boundary. Missing, oversized, malformed UTF-8,
    // or incorrectly encoded responses violate the collaboration contract.
    throw new HTTPException(503, {
      message: 'Collaboration service is unavailable',
      cause: { code: 'COLLABORATION_FAILURE', error },
    });
  }
  if (!response.ok) {
    const errorResponse = internalContentErrorResponseSchema.safeParse(responseBody);
    if (!errorResponse.success) {
      throw new HTTPException(503, {
        message: 'Collaboration service is unavailable',
        cause: { code: 'COLLABORATION_FAILURE', error: errorResponse.error },
      });
    }
    const status: 401 | 403 | 404 | 409 | 413 | 422 | 503 =
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status === 409 ||
      response.status === 413 ||
      response.status === 422
        ? response.status
        : 503;
    const message =
      status === 503 ? 'Collaboration service is unavailable' : errorResponse.data.message;
    const etag =
      response.status === 409 && errorResponse.data.etag ? errorResponse.data.etag : undefined;
    const retryAfterSeconds = errorResponse.data.retryAfterSeconds;
    throw new HTTPException(status, {
      message,
      cause: {
        code:
          errorResponse.data.code ??
          (response.status === 409 ? 'COLLABORATION_CONFLICT' : 'COLLABORATION_FAILURE'),
        ...(etag ? { etag } : {}),
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      },
    });
  }
  return responseBody;
}

function parseResponse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  // This is the private response boundary. A schema mismatch means the
  // collaboration service violated the shared command contract.
  throw new HTTPException(503, {
    message: 'Collaboration service is unavailable',
    cause: { code: 'COLLABORATION_FAILURE', error: parsed.error },
  });
}

export async function readPageMarkdown(
  pageId: string,
  principal: V1Principal,
): Promise<ReadPageMarkdownCommandResponse> {
  return parseResponse(
    readPageMarkdownCommandResponseSchema,
    await postInternal(`/internal/pages/${encodeURIComponent(pageId)}/read-markdown`, principal, {
      successFormat: 'markdown',
    }),
  );
}

export async function replacePageMarkdown(
  pageId: string,
  principal: V1Principal,
  markdown: string,
  ifMatch: string,
): Promise<ReplacePageMarkdownCommandResponse> {
  return parseResponse(
    replacePageMarkdownCommandResponseSchema,
    await postInternal(
      `/internal/pages/${encodeURIComponent(pageId)}/replace-markdown`,
      principal,
      {
        requestBody: {
          contentType: 'text/markdown; charset=utf-8',
          value: markdown,
          headers: { 'If-Match': ifMatch },
        },
      },
    ),
  );
}

export async function applyPageExactEdits(
  pageId: string,
  principal: V1Principal,
  command: ApplyExactEditsCommand,
): Promise<ExactEditCommandResponse> {
  return parseResponse(
    exactEditCommandResponseSchema,
    await postInternal(
      `/internal/pages/${encodeURIComponent(pageId)}/apply-exact-edits`,
      principal,
      {
        requestBody: {
          contentType: 'application/json',
          value: JSON.stringify(applyExactEditsCommandSchema.parse(command)),
        },
      },
    ),
  );
}

export async function applyPageContentBoundaryOperation(
  pageId: string,
  principal: V1Principal,
  command: ApplyContentBoundaryOperationCommand,
): Promise<ContentBoundaryOperationResponse> {
  return parseResponse(
    contentBoundaryOperationResponseSchema,
    await postInternal(
      `/internal/pages/${encodeURIComponent(pageId)}/apply-content-boundary-operation`,
      principal,
      {
        requestBody: {
          contentType: 'application/json',
          value: JSON.stringify(applyContentBoundaryOperationCommandSchema.parse(command)),
        },
      },
    ),
  );
}
