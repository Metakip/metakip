import { getApiLogger } from '@metakip/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

function exceptionCode(error: HTTPException): string {
  const cause = error.cause;
  return cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
    ? cause.code
    : error.status.toString();
}

function exceptionEtag(error: HTTPException): string | null {
  const cause = error.cause;
  return cause && typeof cause === 'object' && 'etag' in cause && typeof cause.etag === 'string'
    ? cause.etag
    : null;
}

function exceptionRetryAfter(error: HTTPException): number | null {
  const cause = error.cause;
  return cause &&
    typeof cause === 'object' &&
    'retryAfterSeconds' in cause &&
    typeof cause.retryAfterSeconds === 'number' &&
    Number.isInteger(cause.retryAfterSeconds) &&
    cause.retryAfterSeconds >= 0
    ? cause.retryAfterSeconds
    : null;
}

function isBodyLimitError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'BodyLimitError';
}

export function v1ErrorResponse(c: Context, error: unknown): Response {
  if (isBodyLimitError(error)) {
    return c.json(
      { error: { code: 'payload_too_large', message: 'Request body is too large' } },
      413,
    );
  }
  if (error instanceof HTTPException) {
    const etag = exceptionEtag(error);
    if (etag) c.header('ETag', etag);
    const retryAfter = exceptionRetryAfter(error);
    if (retryAfter !== null) c.header('Retry-After', retryAfter.toString());
    return c.json(
      {
        error: {
          code: exceptionCode(error),
          message: error.message,
        },
      },
      error.status,
    );
  }

  const logger = getApiLogger();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.error(`Unhandled v1 API error: ${message}`, { stack });
  return c.json({ error: { code: 'internal_error', message: 'Internal Server Error' } }, 500);
}

export function v1NotFound(c: Context) {
  return c.json({ error: { code: 'not_found', message: 'Not Found' } }, 404);
}
