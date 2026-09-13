import { PageMarkdownError } from '@metakip/shared';
import { CollabAccessError } from './collabErrors';
import { ContentCommandPayloadError } from './internalContentCommandPayload';

export class ContentConflictError extends Error {
  constructor(
    message: string,
    readonly etag?: string,
  ) {
    super(message);
  }
}

export class ContentCommandError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function contentCommandErrorStatus(error: unknown): number {
  if (error instanceof ContentConflictError) return 409;
  if (error instanceof ContentCommandError) return error.status;
  if (error instanceof ContentCommandPayloadError || error instanceof SyntaxError) return 400;
  if (error instanceof PageMarkdownError) {
    return error.code === 'document_too_large' ? 413 : 422;
  }
  if (error instanceof CollabAccessError) return 404;
  return 500;
}

export function contentCommandPublicMessage(error: unknown, status: number): string {
  if (status < 500 && error instanceof Error) return error.message;
  return 'Collaboration command failed';
}

export function contentCommandLogLevel(error: unknown, status: number): 'debug' | 'warn' | 'error' {
  if (error instanceof ContentCommandError && error.code === 'collaboration_busy') return 'warn';
  return status < 500 ? 'debug' : 'error';
}
