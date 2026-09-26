import {
  type AccountPagePayload,
  deriveCapabilities,
  MAX_WIKI_LINK_PRESENTATION_REQUESTS,
  normalizePageIcon,
  normalizeWikiLinkLookupKey,
  type PublicPagePayload,
  validatePageProperties,
  type WikiLinkPresentation,
  type WikiLinkPresentationRequest,
  type WikiLinkPresentationResponse,
} from '@metakip/shared';
import { bindWikiLinkTargets, createYjsDocWithTitle } from '@metakip/shared/markdown-yjs';
import { sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { marked } from 'marked';
import { auth } from '../auth';
import { db } from '../db/connection';
import { executeQuery, query } from '../db/query';
import { requireAuth } from '../middleware/auth';
import { deletedPageOwnerSql } from '../utils/deletedEntityOwner';
import { ensureDocumentInputSize, ensureYdocSize } from '../utils/documentSize';
import { purgeEntityAccessMetadata } from '../utils/entityCleanup';
import { movePageToTrash, permanentlyDeletePage, removePageFromView } from '../utils/entityRemoval';
import { getEnumerableFolderIds, redactParentId } from '../utils/folderEnumeration';
import { ensureActorPageAccess, getRequestActor } from '../utils/guestAccess';
import {
  replacePageConnectionIndex,
  replacePageTagConnectionIndex,
} from '../utils/pageConnectionIndex';
import { createPageForActor } from '../utils/pageCreation';
import { exportPageForUser } from '../utils/pageExport';
import {
  copyPageForActor,
  ensurePageOrganizationAccess,
  listTrashedPagesForUser,
  organizePageForUser,
  restorePageForUser,
} from '../utils/pageLifecycle';
import { notifyPageRename, replacePageRecordFields } from '../utils/pageMutation';
import { getPageById, getPageByIdForUpdate } from '../utils/pageRepository';
import {
  type NormalizedPageRow,
  normalizePageRow,
  type PageDatabaseRow,
  type PageDatabaseRowWithOwner,
  toPageResponse,
} from '../utils/pageRows';
import { normalizePageTitle } from '../utils/pageTitle';
import { normalizePosition } from '../utils/position';
import {
  getPublicPermission,
  type PublicPermission,
  recordPublicVisitAndNotify,
  resolveEntityAccess,
} from '../utils/publicAccess';
import {
  ensurePageAccess,
  lockEntityAccess,
  lockWorkspaceAccessMutation,
  type SharePermission,
} from '../utils/share-access';
import { notifyShareRecompute } from '../utils/share-notify';
import { getEntityMetaUserIds, mergeMetaUserIds } from '../utils/shareRecipients';
import { purgeUnreferencedUploadsForPages } from '../utils/uploadCleanup';
import { getUniqueWorkspacePageLookup } from '../utils/wiki-link-lookup';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isLocalWikiLinkHeading = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith('#') && trimmed.slice(1).trim().length > 0;
};

const pagesRoute = new Hono();
const pagesPublicRoute = new Hono();

function parsePageIcon(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new HTTPException(400, { message: 'icon must be a string or null' });
  }
  return normalizePageIcon(value);
}

pagesRoute.use('*', requireAuth);

const _markdownToHtml = (markdown: string): string => {
  return marked.parse(markdown, { async: false }) as string;
};

const isValidMarkdown = (markdown: string): boolean => {
  try {
    marked.parse(markdown, { async: false });
    return true;
  } catch {
    return false;
  }
};

const toPageDto = (page: NormalizedPageRow, parentId: string | null) => ({
  id: page.id,
  parentId,
  title: page.title,
  icon: page.icon,
  coverType: page.coverType,
  coverValue: page.coverValue,
  position: page.position,
  properties: page.properties,
  createdBy: page.createdBy,
  ownerId: page.ownerId ?? null,
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
  publicPermission: page.publicPermission,
  inheritancePolicy: page.inheritancePolicy,
});

const serializeTimestamp = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === 'string' ? value : value.toISOString();

const toAccountPagePayload = (
  page: NormalizedPageRow,
  parentId: string | null,
  publicPermission: PublicPermission | null,
  userPermission: SharePermission,
  fullAccess: boolean,
): AccountPagePayload => ({
  accessScope: 'account',
  ...toPageDto(page, parentId),
  createdAt: serializeTimestamp(page.createdAt),
  updatedAt: serializeTimestamp(page.updatedAt),
  publicPermission,
  userPermission,
  capabilities: deriveCapabilities(userPermission, fullAccess),
});

const toPublicPageDto = (
  page: NormalizedPageRow,
  publicPermission: PublicPermission,
  userPermission: PublicPermission,
): PublicPagePayload => ({
  accessScope: 'public' as const,
  id: page.id,
  title: page.title,
  icon: page.icon,
  coverType: page.coverType,
  coverValue: page.coverValue,
  properties: page.properties,
  updatedAt: serializeTimestamp(page.updatedAt),
  publicPermission,
  userPermission,
  capabilities: deriveCapabilities(userPermission),
});

const toPublicPageMetadataDto = (page: NormalizedPageRow) => ({
  id: page.id,
  title: page.title,
  icon: page.icon,
  coverType: page.coverType,
  coverValue: page.coverValue,
  properties: page.properties,
  updatedAt: page.updatedAt,
});

pagesRoute.get('/tree', async (c) => {
  // Return pages the user can access (owned or shared)
  const user = c.get('user') as { id: string };

  type PageTreeDatabaseRow = PageDatabaseRowWithOwner & {
    enumerable_parent_id: string | null;
    user_permission: SharePermission | null;
    workspace_access: boolean;
  };
  const result = await query<PageTreeDatabaseRow>(
    sql`
      select p.*,
             coalesce(get_root_folder_owner(p.parent_id), p.created_by) as owner_id,
             case
               when p.parent_id in (select folder_id from get_enumerable_folder_ids(${user.id}))
                 then p.parent_id
               else null
             end as enumerable_parent_id,
             access.permission as user_permission,
             exists (
               select 1 from workspace_members wm
               where wm.workspace_owner_id = coalesce(get_root_folder_owner(p.parent_id), p.created_by)
                 and wm.member_id = ${user.id}
                 and not is_page_path_restricted(p.id)
             ) as workspace_access
      from pages p
      join lateral get_effective_page_permission(p.id, ${user.id}) access on true
      where p.is_deleted = false
        and p.id in (select page_id from get_accessible_page_ids(${user.id}))
      order by p.parent_id nulls first, case when p.parent_id is null then p.updated_at end desc nulls last, p.position::numeric asc
    `,
  );

  const pagesList = result.rows.map((row) => {
    const page = normalizePageRow(row, row.owner_id);
    return {
      ...toPageDto(page, row.enumerable_parent_id ?? null),
      userPermission: row.user_permission ?? null,
      workspaceAccess: row.workspace_access === true,
    };
  });
  return c.json(
    pagesList.map((page) => ({
      ...page,
      children: [],
    })),
  );
});

pagesPublicRoute.post(
  '/',
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ message: 'Request body is too large' }, 413),
  }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new HTTPException(400, { message: 'Invalid JSON body' });
      }
      throw error;
    }
    if (!body || typeof body !== 'object') {
      throw new HTTPException(400, { message: 'Invalid body' });
    }

    const { parentId, title, icon } = body as {
      parentId?: string | null;
      title?: string;
      icon?: string | null;
    };

    const actor = await getRequestActor(c);
    if (!parentId && actor.kind === 'guest') {
      throw new HTTPException(401, { message: 'Log in to create a root page' });
    }

    const pageTitle = typeof title === 'string' ? normalizePageTitle(title) : 'Untitled';
    const createdResult = await createPageForActor({
      actor,
      parentId: parentId ?? null,
      title: pageTitle,
      icon: icon === undefined ? null : parsePageIcon(icon),
    });
    const created = normalizePageRow(createdResult.page, createdResult.ownerId);
    return c.json(toPageResponse(created), 201);
  },
);

pagesRoute.get('/trash', async (c) => {
  const user = c.get('user') as { id: string };
  return c.json((await listTrashedPagesForUser(user.id)).map(toPageResponse));
});

pagesRoute.delete('/trash/empty-all', async (c) => {
  const user = c.get('user') as { id: string };
  const count = await db.transaction(async (tx) => {
    await lockWorkspaceAccessMutation(tx, user.id);
    const trashedPages = await executeQuery<{ id: string }>(
      tx,
      sql`select p.id
       from pages p
       left join folders parent on parent.id = p.parent_id
       where p.is_deleted = true
         and ${deletedPageOwnerSql} = ${user.id}
         and coalesce(parent.is_deleted, false) = false
       order by p.id
       for update of p`,
    );
    const pageIds = trashedPages.rows.map((row) => row.id);
    await purgeUnreferencedUploadsForPages(tx, pageIds);
    if (pageIds.length > 0) {
      await purgeEntityAccessMetadata(tx, 'page', pageIds);
      await executeQuery(
        tx,
        sql`delete from pages where id = any(${sql.param(pageIds)}::uuid[]) and is_deleted = true`,
      );
    }
    return pageIds.length;
  });
  return c.json({ deleted: true, count });
});

pagesRoute.get('/recent', async (c) => {
  const limitParam = c.req.query('limit');
  if (limitParam && !/^\d+$/.test(limitParam)) {
    throw new HTTPException(400, { message: 'limit must be a positive integer' });
  }
  const parsedLimit = limitParam ? Number(limitParam) : 10;
  if (!Number.isSafeInteger(parsedLimit) || parsedLimit <= 0) {
    throw new HTTPException(400, { message: 'limit must be a positive integer' });
  }

  const user = c.get('user') as { id: string };

  const result = await query(
    sql`select
       p.id,
       p.title,
       p.icon,
       p.created_by as "createdBy",
       coalesce(get_root_folder_owner(p.parent_id), p.created_by) as "ownerId",
       p.updated_at as "updatedAt",
       pv.visited_at as "visitedAt"
     from page_visits pv
     join pages p on p.id = pv.page_id
     join lateral get_effective_page_permission(p.id, ${user.id}) access on true
     where pv.user_id = ${user.id}
       and p.is_deleted = false
       and access.permission is not null
     order by pv.visited_at desc
     limit ${parsedLimit}`,
  );

  return c.json(
    result.rows as {
      id: string;
      title: string;
      icon: string | null;
      createdBy: string | null;
      ownerId: string | null;
      updatedAt: Date;
      visitedAt: Date;
    }[],
  );
});

pagesPublicRoute.patch(
  ':id/metadata',
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ message: 'Request body is too large' }, 413),
  }),
  async (c) => {
    const pageId = c.req.param('id');
    const actor = await getRequestActor(c);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new HTTPException(400, { message: 'Invalid body' });
    }
    if (Object.hasOwn(body, 'parentId') || Object.hasOwn(body, 'position')) {
      throw new HTTPException(403, { message: 'Editor access cannot reorganize pages' });
    }
    const { title, icon, coverType, coverValue, properties } = body as {
      title?: unknown;
      icon?: unknown;
      coverType?: unknown;
      coverValue?: unknown;
      properties?: unknown;
    };
    const hasTitle = Object.hasOwn(body, 'title');
    const hasIcon = Object.hasOwn(body, 'icon');
    const hasCoverType = Object.hasOwn(body, 'coverType');
    const hasCoverValue = Object.hasOwn(body, 'coverValue');
    const hasProperties = Object.hasOwn(body, 'properties');

    if (actor.kind === 'guest' && (hasIcon || hasCoverType || hasCoverValue)) {
      throw new HTTPException(403, {
        message: 'Guest editors cannot change page icons or covers',
      });
    }

    const result = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      await ensureActorPageAccess(actor, pageId, 'edit', tx);
      const page = await getPageById(pageId, tx);
      if (!page) throw new HTTPException(404, { message: 'Page not found' });
      const nextTitle = hasTitle
        ? typeof title === 'string'
          ? normalizePageTitle(title)
          : (() => {
              throw new HTTPException(400, { message: 'title must be a string' });
            })()
        : page.title;
      const nextIcon = hasIcon ? parsePageIcon(icon) : page.icon;
      const normalizeOptionalText = (value: unknown, field: string): string | null => {
        if (value === null || value === '') return null;
        if (typeof value !== 'string') {
          throw new HTTPException(400, { message: `${field} must be a string or null` });
        }
        return value.trim() || null;
      };
      const nextCoverType = hasCoverType
        ? normalizeOptionalText(coverType, 'coverType')
        : page.coverType;
      const nextCoverValue = hasCoverValue
        ? normalizeOptionalText(coverValue, 'coverValue')
        : page.coverValue;
      const propertiesError = hasProperties ? validatePageProperties(properties) : null;
      if (propertiesError) {
        throw new HTTPException(400, { message: propertiesError });
      }
      const nextProperties = hasProperties ? JSON.stringify(properties) : page.properties;
      const updated = await executeQuery<PageDatabaseRow>(
        tx,
        sql`update pages
         set title_revision = title_revision + case when title is distinct from ${nextTitle} then 1 else 0 end,
             title = ${nextTitle}, title_search = to_tsvector('english', ${nextTitle}), icon = ${nextIcon},
             cover_type = ${nextCoverType}, cover_value = ${nextCoverValue}, properties = ${nextProperties}, updated_at = now()
         where id = ${pageId}
         returning *`,
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) throw new HTTPException(500, { message: 'Failed to update page' });
      if (hasProperties) {
        await replacePageTagConnectionIndex(tx, pageId, updatedRow.ydoc, properties);
      }
      if (page.title !== nextTitle) {
        await executeQuery(
          tx,
          sql`select pg_notify(${'page_renamed'}, ${JSON.stringify({ pageId })})`,
        );
      }
      return normalizePageRow(updatedRow, page.ownerId);
    });
    return c.json(toPublicPageMetadataDto(result));
  },
);

pagesPublicRoute.patch(
  ':id/title',
  bodyLimit({
    maxSize: 4 * 1024,
    onError: (c) => c.json({ message: 'Request body is too large' }, 413),
  }),
  async (c) => {
    const pageId = c.req.param('id');
    const actor = await getRequestActor(c);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        // Malformed JSON is an expected HTTP boundary failure.
        throw new HTTPException(400, { message: 'Invalid JSON body' });
      }
      throw error;
    }
    if (
      !body ||
      typeof body !== 'object' ||
      typeof (body as { title?: unknown }).title !== 'string'
    ) {
      throw new HTTPException(400, { message: 'Title is required' });
    }
    const nextTitle = normalizePageTitle((body as { title: string }).title);

    const result = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      const page = await getPageById(pageId, tx);
      if (!page) {
        throw new HTTPException(404, { message: 'Page not found' });
      }
      await ensureActorPageAccess(actor, pageId, 'edit', tx);

      if (page.title !== nextTitle) {
        await executeQuery(
          tx,
          sql`update pages
           set title_revision = title_revision + 1,
               title = ${nextTitle},
               title_search = to_tsvector('english', ${nextTitle}),
               updated_at = now()
           where id = ${pageId}`,
        );
        await executeQuery(
          tx,
          sql`select pg_notify(${'page_renamed'}, ${JSON.stringify({ pageId })})`,
        );
      }
      return { title: nextTitle };
    });

    return c.json(result);
  },
);

pagesPublicRoute.post(
  ':id/wiki-link-presentations',
  bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ message: 'Request body is too large' }, 413),
  }),
  async (c) => {
    c.header('Cache-Control', 'no-store');
    const sourcePageId = c.req.param('id');
    if (!UUID_PATTERN.test(sourcePageId)) {
      throw new HTTPException(400, { message: 'A valid source page is required' });
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      if (error instanceof Error && error.name === 'BodyLimitError') throw error;
      throw new HTTPException(400, { message: 'Invalid JSON body' });
    }
    const rawLinks =
      body && typeof body === 'object' && 'links' in body
        ? (body as { links?: unknown }).links
        : undefined;
    if (
      !Array.isArray(rawLinks) ||
      rawLinks.length === 0 ||
      rawLinks.length > MAX_WIKI_LINK_PRESENTATION_REQUESTS
    ) {
      throw new HTTPException(400, {
        message: `links must contain between 1 and ${MAX_WIKI_LINK_PRESENTATION_REQUESTS} items`,
      });
    }

    const links: WikiLinkPresentationRequest[] = [];
    const keys = new Set<string>();
    for (const rawLink of rawLinks) {
      if (!rawLink || typeof rawLink !== 'object') {
        throw new HTTPException(400, { message: 'Each link must be an object' });
      }
      const key = 'key' in rawLink ? rawLink.key : undefined;
      const targetId = 'targetId' in rawLink ? rawLink.targetId : undefined;
      const path = 'path' in rawLink ? rawLink.path : undefined;
      if (
        typeof key !== 'string' ||
        key.length === 0 ||
        key.length > 128 ||
        keys.has(key) ||
        (targetId !== undefined &&
          (typeof targetId !== 'string' || !UUID_PATTERN.test(targetId))) ||
        (path !== undefined && (typeof path !== 'string' || path.length > 1_000)) ||
        (targetId === undefined &&
          (typeof path !== 'string' ||
            (!normalizeWikiLinkLookupKey(path) && !isLocalWikiLinkHeading(path))))
      ) {
        throw new HTTPException(400, { message: 'Each link needs a unique key and valid target' });
      }
      keys.add(key);
      links.push({
        key,
        ...(typeof targetId === 'string' && { targetId: targetId.toLowerCase() }),
        ...(typeof path === 'string' && { path }),
      });
    }

    const actor = await getRequestActor(c);
    const response = await db.transaction(async (tx): Promise<WikiLinkPresentationResponse> => {
      await lockEntityAccess(tx, 'page', sourcePageId);
      await ensureActorPageAccess(actor, sourcePageId, 'view', tx);
      const sourceResult = await executeQuery<{ owner_id: string | null }>(
        tx,
        sql`select coalesce(get_root_folder_owner(parent_id), created_by) as owner_id
         from pages where id = ${sourcePageId} and is_deleted = false`,
      );
      const ownerId = sourceResult.rows[0]?.owner_id;
      if (!ownerId) throw new HTTPException(404, { message: 'Page not found' });

      const pathKeys = [
        ...new Set(
          links
            .filter((link) => !link.targetId && link.path)
            .map((link) => normalizeWikiLinkLookupKey(link.path ?? ''))
            .filter(Boolean),
        ),
      ];
      const mappedTargets = new Map<string, string>();
      if (pathKeys.length > 0) {
        const mapped = await executeQuery<{ target_slug: string; target_id: string }>(
          tx,
          sql`select target_slug, min(target_id::text)::uuid as target_id
           from connections
           where source_type = 'page' and source_id = ${sourcePageId}
             and target_type = 'page' and target_id is not null
             and target_slug = any(${sql.param(pathKeys)}::text[])
             and connection_type in ('wikilink', 'heading')
           group by target_slug
           having count(distinct target_id) = 1`,
        );
        for (const row of mapped.rows) mappedTargets.set(row.target_slug, row.target_id);
      }

      const autoLookup = new Map<string, string>();
      if (pathKeys.length > 0) {
        if (actor.kind === 'user') {
          const requesterLookup = await getUniqueWorkspacePageLookup(ownerId, actor.id, tx);
          for (const pathKey of pathKeys) {
            const pageId = requesterLookup.get(pathKey);
            if (pageId) autoLookup.set(pathKey, pageId);
          }
        } else {
          const publicPages = await executeQuery<{ id: string; title: string }>(
            tx,
            sql`select p.id, p.title
             from pages p
             where p.is_deleted = false
               and coalesce(get_root_folder_owner(p.parent_id), p.created_by) = ${ownerId}
               and get_public_page_permission(p.id) is not null`,
          );
          const publicByTitle = new Map<string, string[]>();
          for (const page of publicPages.rows) {
            const lookupKey = normalizeWikiLinkLookupKey(page.title);
            const ids = publicByTitle.get(lookupKey) ?? [];
            ids.push(page.id);
            publicByTitle.set(lookupKey, ids);
          }
          for (const pathKey of pathKeys) {
            const ids = publicByTitle.get(pathKey);
            if (ids?.length === 1 && ids[0]) autoLookup.set(pathKey, ids[0]);
          }
        }
      }

      const candidateByKey = new Map<string, { id: string }>();
      for (const link of links) {
        if (link.targetId) {
          candidateByKey.set(link.key, { id: link.targetId });
          continue;
        }
        const pathKey = normalizeWikiLinkLookupKey(link.path ?? '');
        if (!pathKey && isLocalWikiLinkHeading(link.path ?? '')) {
          candidateByKey.set(link.key, { id: sourcePageId });
          continue;
        }
        const mappedId = mappedTargets.get(pathKey);
        const automaticId = autoLookup.get(pathKey);
        const candidateId = mappedId ?? automaticId;
        if (candidateId) {
          candidateByKey.set(link.key, { id: candidateId });
        }
      }

      const candidateIds = [...new Set([...candidateByKey.values()].map(({ id }) => id))];
      const knownTargets = new Map<string, { id: string; title: string; accessible: boolean }>();
      if (candidateIds.length > 0) {
        const targets = await executeQuery<{ id: string; title: string; accessible: boolean }>(
          tx,
          sql`select target.id, target.title,
                  case
                    when ${actor.kind === 'user' ? actor.id : null}::uuid is not null then exists (
                      select 1 from get_effective_page_permission(target.id, ${actor.kind === 'user' ? actor.id : null}::uuid) access
                      where access.permission is not null
                    )
                    else get_public_page_permission(target.id) is not null
                  end as accessible
           from pages target
           where target.id = any(${sql.param(candidateIds)}::uuid[])
             and target.is_deleted = false
             and coalesce(get_root_folder_owner(target.parent_id), target.created_by) = ${ownerId}`,
        );
        for (const target of targets.rows) knownTargets.set(target.id, target);
      }

      const presentations: WikiLinkPresentation[] = links.map((link) => {
        const candidate = candidateByKey.get(link.key);
        if (!candidate) return { key: link.key, state: 'unavailable' };
        const target = knownTargets.get(candidate.id);
        if (!target) return { key: link.key, state: 'unavailable' };
        if (target.accessible) {
          return {
            key: link.key,
            state: 'accessible',
            target: { id: target.id, title: target.title },
          };
        }
        return { key: link.key, state: 'restricted' };
      });
      return { links: presentations };
    });

    return c.json(response);
  },
);

pagesPublicRoute.get(
  ':id{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}}',
  async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    const pageId = c.req.param('id');
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const sessionUserId = session?.user ? (session.user as { id: string }).id : null;
    const result = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      const page = await getPageById(pageId, tx);
      if (!page) {
        throw new HTTPException(404, { message: 'Page not found' });
      }

      const resolvedAccess = sessionUserId
        ? await resolveEntityAccess('page', pageId, sessionUserId, tx)
        : null;
      const publicPermission = resolvedAccess
        ? resolvedAccess.publicPermission
        : await getPublicPermission('page', pageId, tx);
      const hasAccountAccess = Boolean(resolvedAccess?.accountPermission);
      let userPermission: SharePermission;
      let fullAccess = false;
      if (resolvedAccess) {
        if (!resolvedAccess.permission) {
          throw new HTTPException(403, { message: "You don't have access to this page" });
        }
        userPermission = resolvedAccess.permission;
        fullAccess = resolvedAccess.fullAccess;
      } else {
        if (!publicPermission) {
          throw new HTTPException(401, { message: 'Log in to access this page' });
        }
        userPermission = publicPermission;
      }

      if (sessionUserId) {
        await executeQuery(
          tx,
          sql`insert into page_visits (user_id, page_id, visited_at) values (${sessionUserId}, ${pageId}, now()) on conflict (user_id, page_id) do update set visited_at = excluded.visited_at`,
        );
        if (publicPermission && page.ownerId !== sessionUserId) {
          await recordPublicVisitAndNotify(tx, 'page', pageId, sessionUserId);
        }
      }

      const enumerableFolderIds =
        sessionUserId && hasAccountAccess
          ? await getEnumerableFolderIds(sessionUserId, tx)
          : new Set<string>();

      if (!hasAccountAccess) {
        if (!publicPermission) {
          throw new HTTPException(403, { message: 'You do not have public access to this page' });
        }
        return toPublicPageDto(page, publicPermission, publicPermission);
      }

      return toAccountPagePayload(
        page,
        redactParentId(page.parentId, enumerableFolderIds),
        publicPermission,
        userPermission,
        fullAccess,
      );
    });

    return c.json(result);
  },
);

pagesRoute.post(':id/access', async (c) => {
  const pageId = c.req.param('id');
  const user = c.get('user') as { id: string };
  await db.transaction(async (tx) => {
    await lockEntityAccess(tx, 'page', pageId);
    const page = await getPageById(pageId, tx);
    if (!page) throw new HTTPException(404, { message: 'Page not found' });
    await ensurePageAccess(pageId, user.id, 'view', tx);
    if ((await getPublicPermission('page', pageId, tx)) && page.ownerId !== user.id) {
      await recordPublicVisitAndNotify(tx, 'page', pageId, user.id);
    }
    await executeQuery(
      tx,
      sql`insert into page_visits (user_id, page_id, visited_at) values (${user.id}, ${pageId}, now()) on conflict (user_id, page_id) do update set visited_at = excluded.visited_at`,
    );
  });

  return c.json({ ok: true });
});

pagesRoute.patch(':id/restore', async (c) => {
  const pageId = c.req.param('id');
  const user = c.get('user') as { id: string };
  return c.json(toPageResponse(await restorePageForUser(pageId, user.id)));
});

pagesRoute.patch(':id', async (c) => {
  const pageId = c.req.param('id');
  const page = await getPageById(pageId);

  if (!page) {
    throw new HTTPException(404, { message: 'Page not found' });
  }

  const user = c.get('user') as { id: string };

  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      // Malformed JSON is an expected HTTP boundary failure.
      throw new HTTPException(400, { message: 'Invalid JSON body' });
    }
    throw error;
  }
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }

  const { title, icon, parentId, position, coverType, coverValue, properties } = body as {
    title?: string;
    icon?: string | null;
    parentId?: string | null;
    position?: string | number;
    coverType?: string | null;
    coverValue?: string | null;
    properties?: Record<string, unknown> | null;
  };

  const hasParentId = Object.hasOwn(body, 'parentId');
  const hasPosition = Object.hasOwn(body, 'position');
  const hasIcon = Object.hasOwn(body, 'icon');
  const hasCoverType = Object.hasOwn(body, 'coverType');
  const hasCoverValue = Object.hasOwn(body, 'coverValue');
  const hasProperties = Object.hasOwn(body, 'properties');
  const propertiesError = hasProperties ? validatePageProperties(properties) : null;
  if (propertiesError) {
    throw new HTTPException(400, { message: propertiesError });
  }
  const normalizedRequestedTitle =
    typeof title === 'string' ? normalizePageTitle(title) : undefined;

  const updateResult = await db.transaction(async (tx) => {
    const workspaceOwnerId = await lockEntityAccess(tx, 'page', pageId);
    const currentPage = await getPageByIdForUpdate(pageId, tx);
    if (!currentPage) {
      throw new HTTPException(404, { message: 'Page not found' });
    }

    const nextParent = hasParentId ? (parentId ?? null) : currentPage.parentId;
    if (hasParentId || hasPosition) {
      await ensurePageOrganizationAccess(currentPage, nextParent, user.id, tx);
    } else {
      await ensurePageAccess(currentPage.id, user.id, 'edit', tx);
    }

    const nextTitle = normalizedRequestedTitle ?? currentPage.title;
    const nextIcon = hasIcon ? parsePageIcon(icon) : currentPage.icon;
    const nextPosition = normalizePosition(position, currentPage.position);
    const nextCoverType = hasCoverType
      ? typeof coverType === 'string' && coverType.trim().length > 0
        ? coverType.trim()
        : null
      : currentPage.coverType;
    const nextCoverValue = hasCoverValue
      ? typeof coverValue === 'string' && coverValue.trim().length > 0
        ? coverValue.trim()
        : null
      : currentPage.coverValue;
    const accessChanged = hasParentId && nextParent !== currentPage.parentId;
    if (accessChanged) {
      await lockWorkspaceAccessMutation(tx, workspaceOwnerId);
    }
    const affectedBefore = accessChanged ? await getEntityMetaUserIds(tx, 'page', pageId) : [];

    const updatedPage = await replacePageRecordFields(tx, {
      pageId,
      title: nextTitle,
      icon: nextIcon,
      parentId: nextParent,
      position: nextPosition,
      coverType: nextCoverType,
      coverValue: nextCoverValue,
      properties: hasProperties
        ? { kind: 'replace', value: properties ?? null }
        : { kind: 'preserve' },
    });
    if (!updatedPage) {
      throw new HTTPException(500, { message: 'Failed to update page' });
    }
    if (hasProperties) {
      await replacePageTagConnectionIndex(tx, pageId, updatedPage.ydoc, properties);
    }

    // Keep the payload bounded; the collaboration server reloads the title
    // from PostgreSQL after this transaction commits.
    if (currentPage.title !== nextTitle) {
      await notifyPageRename(tx, pageId);
    }
    if (accessChanged) {
      const affectedAfter = await getEntityMetaUserIds(tx, 'page', pageId);
      await notifyShareRecompute(
        {
          entityType: 'page',
          entityId: pageId,
          metaUserIds: mergeMetaUserIds(affectedBefore, affectedAfter),
        },
        tx,
      );
    }
    return {
      result: { rows: [updatedPage] },
      ownerId: currentPage.ownerId,
      enumerableFolderIds: await getEnumerableFolderIds(user.id, tx),
    };
  });

  const updatedRow = updateResult.result.rows[0];
  if (!updatedRow) throw new HTTPException(500, { message: 'Failed to update page' });
  const updated = normalizePageRow(updatedRow, updateResult.ownerId);
  return c.json(
    toPageDto(updated, redactParentId(updated.parentId, updateResult.enumerableFolderIds)),
  );
});

pagesRoute.patch(':id/move', async (c) => {
  const pageId = c.req.param('id');
  const user = c.get('user') as { id: string };
  let body: unknown;
  try {
    body = await c.req.json();
  } catch (error) {
    throw new HTTPException(400, { message: 'Invalid JSON body', cause: error });
  }
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }
  const { parentId, position } = body as {
    parentId?: string | null;
    position?: string | number;
  };
  const updated = await organizePageForUser(pageId, user.id, {
    ...(Object.hasOwn(body, 'parentId') ? { parentId: parentId ?? null } : {}),
    ...(position === undefined ? {} : { position }),
  });
  return c.json(toPageDto(updated, updated.parentId));
});

export async function exportPageMarkdown(c: Context) {
  const pageId = c.req.param('id');
  const user = c.get('user') as { id: string };
  const result = await exportPageForUser(pageId, user.id);
  c.header('Content-Type', result.contentType);
  c.header('Content-Disposition', result.contentDisposition);
  if (typeof result.body === 'string') return c.body(result.body);
  const arrayBuffer = result.body.buffer.slice(
    result.body.byteOffset,
    result.body.byteOffset + result.body.byteLength,
  ) as ArrayBuffer;
  return c.newResponse(arrayBuffer, 200);
}

pagesRoute.get(':id/export/markdown', exportPageMarkdown);

pagesRoute.post(':id/import/markdown', async (c) => {
  const pageId = c.req.param('id');
  const page = await getPageById(pageId);

  if (!page) {
    throw new HTTPException(404, { message: 'Page not found' });
  }

  const user = c.get('user') as { id: string };
  await ensurePageAccess(page.id, user.id, 'edit');

  const contentType = c.req.header('content-type') ?? '';
  let markdown = '';

  if (contentType.includes('application/json')) {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new HTTPException(400, { message: 'Invalid body' });
    }
    const bodyMarkdown = (body as { markdown?: string }).markdown;
    markdown = typeof bodyMarkdown === 'string' ? bodyMarkdown : '';
    ensureDocumentInputSize(markdown);
  } else if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get('file');
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: 'File is required' });
    }
    ensureDocumentInputSize(file);
    markdown = await file.text();
  } else {
    throw new HTTPException(415, { message: 'Unsupported content type' });
  }

  if (!markdown.trim()) {
    throw new HTTPException(400, { message: 'Markdown is required' });
  }

  if (!isValidMarkdown(markdown)) {
    throw new HTTPException(400, { message: 'Invalid markdown format' });
  }

  const updateResult = await db.transaction(async (tx) => {
    await lockEntityAccess(tx, 'page', pageId);
    const currentPage = await getPageByIdForUpdate(pageId, tx);
    if (!currentPage) throw new HTTPException(404, { message: 'Page not found' });
    await ensurePageAccess(pageId, user.id, 'edit', tx);

    const ownerId =
      currentPage.ownerId ??
      (
        await executeQuery<{ owner_id: string | null }>(
          tx,
          sql`select coalesce(get_root_folder_owner(parent_id), created_by) as owner_id
           from pages where id = ${pageId}`,
        )
      ).rows[0]?.owner_id;
    if (!ownerId) throw new HTTPException(404, { message: 'Page not found' });
    const pageLookup = await getUniqueWorkspacePageLookup(ownerId, user.id, tx);
    const ydocBuffer = Buffer.from(
      bindWikiLinkTargets(
        createYjsDocWithTitle(currentPage.title || 'Untitled', markdown),
        pageLookup,
      ),
    );
    ensureYdocSize(ydocBuffer);

    await replacePageConnectionIndex(tx, pageId, ydocBuffer, currentPage.properties);

    const updated = await executeQuery(
      tx,
      sql`update pages
       set ydoc = ${ydocBuffer},
           title_revision = title_revision + case when title is distinct from ${currentPage.title || 'Untitled'} then 1 else 0 end,
           title = ${currentPage.title || 'Untitled'},
           title_search = to_tsvector('english', ${currentPage.title || 'Untitled'}),
           updated_at = now()
       where id = ${pageId}`,
    );
    await executeQuery(
      tx,
      sql`select pg_notify(${'page_content_replaced'}, ${JSON.stringify({ pageId })})`,
    );
    return updated;
  });

  if (updateResult.rowCount === 0) {
    throw new HTTPException(500, { message: 'Failed to import page content' });
  }

  return c.json({ success: true });
});

pagesRoute.delete(':id', async (c) => {
  const pageId = c.req.param('id');
  const user = c.get('user') as { id: string };
  await movePageToTrash(pageId, user.id);
  return c.json({ deleted: true });
});

pagesRoute.post(':id/leave', async (c) => {
  const pageId = c.req.param('id');
  const user = c.get('user') as { id: string };
  await removePageFromView(pageId, user.id);
  return c.json({ ok: true });
});

pagesPublicRoute.post(
  ':id/copy',
  bodyLimit({
    maxSize: 4 * 1024,
    onError: (c) => c.json({ message: 'Request body is too large' }, 413),
  }),
  async (c) => {
    const pageId = c.req.param('id');
    const actor = await getRequestActor(c);
    const body = await c.req.json().catch((error: unknown) => {
      if (error instanceof Error && error.name === 'BodyLimitError') throw error;
      return null;
    });
    const parentId =
      body && typeof body === 'object'
        ? ((body as { parentId?: string | null }).parentId ?? null)
        : null;
    if (!parentId && actor.kind === 'guest') {
      throw new HTTPException(401, { message: 'Log in to copy a page to the workspace root' });
    }

    const copiedPage = await copyPageForActor(actor, pageId, parentId);

    const created = normalizePageRow(copiedPage, copiedPage.owner_id);
    return c.json(toPageResponse(created), 201);
  },
);

pagesRoute.delete(':id/permanent', async (c) => {
  const pageId = c.req.param('id');
  const user = c.get('user') as { id: string };
  await permanentlyDeletePage(pageId, user.id);

  return c.json({ deleted: true });
});

export { pagesPublicRoute };
export default pagesRoute;
