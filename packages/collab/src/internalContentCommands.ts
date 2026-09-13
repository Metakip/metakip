import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  contentBoundaryOperationResponseSchema,
  exactEditCommandResponseSchema,
  INTERNAL_CONTENT_HEADERS,
  type InternalContentPrincipal,
  MAX_INTERNAL_CONTENT_COMMAND_BYTES,
  PageMarkdownError,
  readPageMarkdownCommandResponseSchema,
  replacePageMarkdownCommandResponseSchema,
} from '@metakip/shared';
import {
  ContentCommandError,
  ContentConflictError,
  contentCommandErrorStatus,
  contentCommandLogLevel,
  contentCommandPublicMessage,
} from './internalContentCommandErrors';
import {
  type InternalContentCommandOptions,
  type ParsedContentCommand,
  withAuthorizedPageDocument,
} from './internalContentCommandExecution';
import {
  ContentCommandPayloadError,
  parseApplyContentBoundaryOperationCommand,
  parseApplyExactEditsCommand,
  readMarkdownCommandBody,
} from './internalContentCommandPayload';
import { isUuid } from './utils';

type ContentAction = ParsedContentCommand['action'];

function hasInternalAccess(request: IncomingMessage, expected: string | undefined): boolean {
  const provided = request.headers[INTERNAL_CONTENT_HEADERS.secret];
  if (!expected || typeof provided !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
  );
}

function internalHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' && value ? value : null;
}

function readInternalPrincipal(request: IncomingMessage): InternalContentPrincipal | null {
  const userId = internalHeader(request, INTERNAL_CONTENT_HEADERS.userId);
  const requestId = internalHeader(request, INTERNAL_CONTENT_HEADERS.requestId);
  const tokenId = internalHeader(request, INTERNAL_CONTENT_HEADERS.tokenId);
  const idempotencyPrincipal = internalHeader(
    request,
    INTERNAL_CONTENT_HEADERS.idempotencyPrincipal,
  );
  if (
    !userId ||
    !isUuid(userId) ||
    !requestId ||
    !isUuid(requestId) ||
    (tokenId !== null && !isUuid(tokenId)) ||
    !idempotencyPrincipal
  ) {
    return null;
  }
  const expectedPrincipal = tokenId ? `token:${tokenId}` : 'session:';
  if (
    (tokenId && idempotencyPrincipal !== expectedPrincipal) ||
    (!tokenId &&
      (!idempotencyPrincipal.startsWith(expectedPrincipal) ||
        idempotencyPrincipal.length === expectedPrincipal.length))
  ) {
    return null;
  }
  return { userId, requestId, tokenId, idempotencyPrincipal };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_INTERNAL_CONTENT_COMMAND_BYTES) {
      throw new ContentCommandError(413, 'Command is too large');
    }
    chunks.push(buffer);
  }
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    // Incoming command bytes are an external decoding boundary. Invalid
    // UTF-8 is malformed input and must not be replaced silently.
    throw new ContentCommandPayloadError('Command JSON must be valid UTF-8', { cause: error });
  }
  return JSON.parse(json) as unknown;
}

async function parseCommand(
  request: IncomingMessage,
  action: ContentAction,
): Promise<ParsedContentCommand> {
  if (action === 'read-markdown') return { action };
  if (action === 'replace-markdown') {
    const ifMatch = internalHeader(request, 'if-match');
    if (!ifMatch) throw new ContentCommandPayloadError('If-Match is required');
    return { action, ifMatch, markdown: await readMarkdownCommandBody(request) };
  }
  if (action === 'apply-content-boundary-operation') {
    return {
      action,
      command: parseApplyContentBoundaryOperationCommand(await readJson(request)),
    };
  }
  return { action, command: parseApplyExactEditsCommand(await readJson(request)) };
}

function send(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function sendCommandResponse(
  response: ServerResponse,
  action: ContentAction,
  value: unknown,
): void {
  if (action === 'read-markdown') {
    const readResult = readPageMarkdownCommandResponseSchema.parse(value);
    response.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      ETag: readResult.etag,
    });
    response.end(readResult.markdown);
    return;
  }
  if (action === 'replace-markdown') {
    send(response, 200, replacePageMarkdownCommandResponseSchema.parse(value));
    return;
  }
  if (action === 'apply-content-boundary-operation') {
    send(response, 200, contentBoundaryOperationResponseSchema.parse(value));
    return;
  }
  send(response, 200, exactEditCommandResponseSchema.parse(value));
}

export function createInternalContentCommands(options: InternalContentCommandOptions) {
  return async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const match = pathname.match(
      /^\/internal\/pages\/([0-9a-f-]{36})\/(read-markdown|replace-markdown|apply-exact-edits|apply-content-boundary-operation)$/i,
    );
    if (!match) return false;
    const pageId = match[1];
    const action = match[2] as ContentAction | undefined;
    if (request.method !== 'POST' || !pageId || !action || !isUuid(pageId)) {
      send(response, 404, { message: 'Not found' });
      return true;
    }
    if (!hasInternalAccess(request, options.internalSecret)) {
      send(response, 404, { message: 'Not found' });
      return true;
    }
    const principal = readInternalPrincipal(request);
    if (!principal) {
      send(response, 401, { message: 'Unauthorized' });
      return true;
    }

    try {
      // Admission occurs inside withAuthorizedPageDocument before this lazy
      // parser consumes a request body or opens a direct collaboration connection.
      const result = await withAuthorizedPageDocument(options, pageId, principal, () =>
        parseCommand(request, action),
      );
      sendCommandResponse(response, action, result);
    } catch (error) {
      // This private HTTP dispatcher is the command boundary. Known domain
      // failures map to stable statuses; unexpected failures remain 500s.
      const status = contentCommandErrorStatus(error);
      const logMessage = `[internal-content] ${action} page=${pageId} failed: ${error}`;
      options.logger[contentCommandLogLevel(error, status)](logMessage);
      const retryAfterSeconds =
        error instanceof ContentCommandError ? error.retryAfterSeconds : undefined;
      const errorCode =
        error instanceof ContentCommandError
          ? error.code
          : error instanceof PageMarkdownError
            ? error.code
            : undefined;
      send(
        response,
        status,
        {
          message: contentCommandPublicMessage(error, status),
          ...(error instanceof ContentConflictError && error.etag ? { etag: error.etag } : {}),
          ...(errorCode ? { code: errorCode } : {}),
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        },
        retryAfterSeconds === undefined ? {} : { 'Retry-After': retryAfterSeconds.toString() },
      );
    }
    return true;
  };
}
