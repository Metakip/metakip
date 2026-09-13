import { PageMarkdownError, type ParsedPageMarkdown, parsePageMarkdown } from '@metakip/shared';
import { HTTPException } from 'hono/http-exception';
import type { AccessiblePageRow } from '../../utils/pageRepository';
import type { PageResponse } from './pageContracts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PageRow = AccessiblePageRow;

export function requireUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new HTTPException(400, { message: `Invalid ${label}` });
  return value;
}

export function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

export function pageDto(row: PageRow): PageResponse {
  return {
    id: row.id,
    parentId: row.enumerable_parent_id,
    title: row.title,
    icon: row.icon,
    cover: row.cover_type ? { type: row.cover_type, value: row.cover_value } : null,
    properties: row.properties,
    ownerId: row.owner_id,
    permission: row.permission,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function parseContent(markdown: string): ParsedPageMarkdown {
  try {
    return parsePageMarkdown(markdown);
  } catch (error) {
    if (error instanceof PageMarkdownError) {
      throw new HTTPException(error.code === 'document_too_large' ? 413 : 422, {
        message: error.message,
      });
    }
    throw error;
  }
}
