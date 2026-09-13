import type { z } from 'zod';
import type { ImportFile } from './types';
import {
  McpBackendError,
  type McpFolder,
  type McpPage,
  mcpFolderSchema,
  mcpPageSchema,
} from './types';

export type JsonRecord = Record<string, unknown>;

export type TextResponse = {
  body: string;
  etag: string | null;
};

export type PageReference = {
  id: string;
  page: McpPage;
};

export type FolderReference = {
  id: string;
  folder: McpFolder;
};

export function parseApiResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new McpBackendError('Metakip API returned an invalid response', 503, {
      code: 'invalid_upstream_response',
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

export function asRecord(value: unknown, message = 'Invalid API response'): JsonRecord {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  throw new McpBackendError(message, 503, { code: 'invalid_upstream_response' });
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new McpBackendError(`Invalid API response field: ${field}`, 503, {
      code: 'invalid_upstream_response',
    });
  }
  return value;
}

export function requireEtag(value: string | null): string {
  if (value === null || value.length === 0) {
    throw new McpBackendError('Metakip API response did not include an ETag', 503, {
      code: 'invalid_upstream_response',
    });
  }
  return value;
}

export function responseErrorBody(value: unknown): {
  message: string;
  code?: string;
  details?: unknown;
} {
  const body = asRecord(value, 'Invalid API error response');
  const error = body.error;
  if (typeof error === 'string') return { message: error };
  if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
    const errorObject = error as JsonRecord;
    return {
      message:
        typeof errorObject.message === 'string'
          ? errorObject.message
          : 'Metakip API request failed',
      ...(typeof errorObject.code === 'string' ? { code: errorObject.code } : {}),
      ...(errorObject.details === undefined ? {} : { details: errorObject.details }),
    };
  }
  return {
    message: typeof body.message === 'string' ? body.message : 'Metakip API request failed',
  };
}

export function pageOutput(value: unknown): McpPage {
  return parseApiResponse(mcpPageSchema, value);
}

export function folderOutput(value: unknown): McpFolder {
  const folder = asRecord(value);
  const output: JsonRecord = {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    icon: folder.icon,
    ownerId: folder.ownerId,
    permission: folder.permission,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
  if (folder.folderPath !== undefined) output.path = folder.folderPath;
  return parseApiResponse(mcpFolderSchema, output);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof McpBackendError ? error.code : undefined;
}

export function lifecycleStatus(error: unknown): 'failed' | 'outcome_uncertain' {
  return errorCode(error) === 'outcome_uncertain' ? 'outcome_uncertain' : 'failed';
}

export function folderPathFromFiles(files: readonly ImportFile[]): number {
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(parts.slice(0, index).join('/'));
    }
  }
  return folders.size;
}
