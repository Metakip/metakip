import { PageMarkdownError, type ParsedPageMarkdown, parsePageMarkdown } from '@metakip/shared';
import { HTTPException } from 'hono/http-exception';
import type { AccessiblePageRow } from '../../utils/pageRepository';
import { toIsoTimestamp } from '../../utils/toIsoTimestamp';
import type { PageResponse } from './pageContracts';

export { requireUuid } from '../../utils/uuid';

export type PageRow = AccessiblePageRow;

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
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
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
