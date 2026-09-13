import {
  getUnicodeCodePointLength,
  MAX_PAGE_TITLE_LENGTH,
  normalizePageIcon,
} from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/connection';
import { query } from '../../db/query';
import { recordTokenAuditEvent, requireV1OperationScope } from '../../middleware/v1Auth';
import { createPage } from '../../utils/pageCreation';
import { notifyPageRename, updatePageMetadata } from '../../utils/pageMutation';
import {
  type AccessiblePagePathRow,
  accessiblePagePathsCte,
  getAccessiblePageById,
  pageMetadataSelection,
} from '../../utils/pageRepository';
import { normalizePageTitle } from '../../utils/pageTitle';
import { ensurePageAccess, lockEntityAccess } from '../../utils/share-access';
import { createPageRequestSchema, pageOperations, updatePageRequestSchema } from './pageContracts';
import { type PageRow, pageDto, parseContent, requireUuid } from './pageModel';
import { v1DocumentJsonBodyLimit, v1JsonBodyLimit } from './requestLimits';
import { parseJsonRequest } from './requestValidation';
import {
  decodeResourceCursor,
  encodeResourceCursor,
  parseResourceLimit,
  type ResourceCursorRow,
} from './resourceCursor';

type PageListRow = PageRow & ResourceCursorRow;

const pageResourcesRoute = new Hono();

pageResourcesRoute.get(
  pageOperations.list.routePath,
  requireV1OperationScope(pageOperations.list),
  async (c) => {
    const principal = c.get('v1Principal');
    const cursor = decodeResourceCursor(c.req.query('cursor'));
    const parentIdValue = c.req.query('parentId');
    const parentId = parentIdValue === undefined ? null : requireUuid(parentIdValue, 'parentId');
    const parsedLimit = parseResourceLimit(c.req.query('limit'));
    const result = await query<PageListRow>(
      sql`select ${pageMetadataSelection},
        coalesce(get_root_folder_owner(p.parent_id), p.created_by) as owner_id,
        case
          when p.parent_id in (select folder_id from get_enumerable_folder_ids(${principal.userId}))
          then p.parent_id
          else null
        end as enumerable_parent_id,
        access.permission,
        to_char(p.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') as cursor_updated_at
      from pages p
      join lateral get_effective_page_permission(p.id, ${principal.userId}) access on true
      where p.is_deleted = false
        and p.id in (select page_id from get_accessible_page_ids(${principal.userId}))
        and access.permission is not null
        ${
          parentId
            ? sql`and p.parent_id = ${parentId}
                and p.parent_id in (
                  select folder_id from get_enumerable_folder_ids(${principal.userId})
                )`
            : sql``
        }
        ${cursor ? sql`and (p.updated_at, p.id) < (${cursor.updatedAt}::timestamp, ${cursor.id})` : sql``}
      order by p.updated_at desc, p.id desc
      limit ${parsedLimit + 1}`,
    );
    const hasMore = result.rows.length > parsedLimit;
    const rows = result.rows.slice(0, parsedLimit);
    const last = rows.at(-1);
    return c.json({
      data: rows.map(pageDto),
      nextCursor: hasMore && last ? encodeResourceCursor(last) : null,
    });
  },
);

pageResourcesRoute.get(
  pageOperations.search.routePath,
  requireV1OperationScope(pageOperations.search),
  async (c) => {
    const principal = c.get('v1Principal');
    const textQuery = c.req.query('q')?.trim() ?? '';
    if (!textQuery) return c.json({ data: [] });

    const searchPattern = `%${textQuery}%`;
    const result = await query<AccessiblePagePathRow & { rank: number | null }>(
      sql`${accessiblePagePathsCte(principal.userId)}
      select p.*,
        ts_rank(p.title_search, plainto_tsquery('english', ${textQuery})) as rank
      from accessible_page_paths p
      where (
        p.title_search @@ plainto_tsquery('english', ${textQuery})
        or p.title ilike ${searchPattern}
      )
      order by rank desc nulls last, p.updated_at desc, p.id
      limit 20`,
    );

    return c.json({
      data: result.rows.map((row) => ({ ...pageDto(row), folderPath: row.folder_path })),
    });
  },
);

pageResourcesRoute.post(
  pageOperations.create.routePath,
  requireV1OperationScope(pageOperations.create),
  v1DocumentJsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const request = await parseJsonRequest(c, createPageRequestSchema);
    const title = normalizePageTitle(request.title ?? '');
    const parentId = request.parentId ?? null;
    const parsed = parseContent(request.markdown ?? '');

    const created = await db.transaction(async (tx) => {
      const { page } = await createPage(tx, {
        actor: { kind: 'user', id: principal.userId },
        parentId,
        title,
        icon: request.icon === undefined ? parsed.icon : normalizePageIcon(request.icon),
        content: { kind: 'markdown', body: parsed.body, properties: parsed.properties },
      });
      await recordTokenAuditEvent(principal, 'page.create', 'success', page.id, tx);
      const accessiblePage = await getAccessiblePageById(page.id, principal.userId, tx);
      if (!accessiblePage) {
        throw new HTTPException(500, { message: 'Created page is not accessible' });
      }
      return accessiblePage;
    });
    return c.json(pageDto(created), 201);
  },
);

pageResourcesRoute.get(
  pageOperations.resolveTitle.routePath,
  requireV1OperationScope(pageOperations.resolveTitle),
  async (c) => {
    const principal = c.get('v1Principal');
    const title = c.req.query('title')?.trim();
    if (!title || getUnicodeCodePointLength(title) > MAX_PAGE_TITLE_LENGTH) {
      throw new HTTPException(400, {
        message: `title must be between 1 and ${MAX_PAGE_TITLE_LENGTH} characters`,
      });
    }
    const result =
      await query<AccessiblePagePathRow>(sql`${accessiblePagePathsCte(principal.userId)}
    select p.*
    from accessible_page_paths p
    where lower(p.title) = lower(${title})
    order by p.folder_path, p.id`);
    return c.json({
      data: result.rows.map((row) => ({ ...pageDto(row), folderPath: row.folder_path })),
    });
  },
);

pageResourcesRoute.get(
  pageOperations.get.routePath,
  requireV1OperationScope(pageOperations.get),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const page = await getAccessiblePageById(pageId, principal.userId);
    if (!page) throw new HTTPException(404, { message: 'Page not found' });
    return c.json(pageDto(page));
  },
);

pageResourcesRoute.patch(
  pageOperations.update.routePath,
  requireV1OperationScope(pageOperations.update),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const request = await parseJsonRequest(c, updatePageRequestSchema);
    const updated = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      await ensurePageAccess(pageId, principal.userId, 'edit', tx);
      const current = await getAccessiblePageById(pageId, principal.userId, tx);
      if (!current) throw new HTTPException(404, { message: 'Page not found' });
      const title = request.title === undefined ? undefined : normalizePageTitle(request.title);
      const icon = request.icon === undefined ? undefined : normalizePageIcon(request.icon);
      const row = await updatePageMetadata(tx, {
        pageId,
        ...(title === undefined ? {} : { title }),
        ...(icon === undefined ? {} : { icon }),
      });
      if (!row) throw new HTTPException(500, { message: 'Failed to update page' });
      if (current.title !== row.title) {
        await notifyPageRename(tx, pageId);
      }
      await recordTokenAuditEvent(principal, 'page.update', 'success', pageId, tx);
      return {
        ...row,
        enumerable_parent_id: current.enumerable_parent_id,
        owner_id: current.owner_id,
        permission: current.permission,
      };
    });
    if (!updated) throw new HTTPException(500, { message: 'Failed to update page' });
    return c.json(pageDto(updated));
  },
);

export default pageResourcesRoute;
