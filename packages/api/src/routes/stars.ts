import type { ShareEntityType } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { query } from '../db/query';
import { requireAuth } from '../middleware/auth';
import { ensureFolderAccess, ensurePageAccess } from '../utils/share-access';

type StarRow = {
  entity_type: ShareEntityType;
  entity_id: string;
  title: string;
  icon: string | null;
  owner_id: string | null;
  share_source: 'direct' | 'public' | 'workspace' | null;
  created_at: Date | null;
};

const starsRoute = new Hono();

starsRoute.use('*', requireAuth);

const parseEntityType = (value: unknown): ShareEntityType => {
  if (value === 'page' || value === 'folder') {
    return value;
  }
  throw new HTTPException(400, { message: 'Invalid entityType' });
};

const ensureEntityAccess = async (
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
) => {
  if (entityType === 'page') {
    await ensurePageAccess(entityId, userId);
    return;
  }
  await ensureFolderAccess(entityId, userId);
};

starsRoute.get('/', async (c) => {
  const user = c.get('user');

  const result = await query<StarRow>(
    sql`select
       uf.entity_type,
       uf.entity_id,
       case when uf.entity_type = 'folder' then f.name else p.title end as title,
       case when uf.entity_type = 'folder' then f.icon else p.icon end as icon,
       case
         when uf.entity_type = 'folder' then get_root_folder_owner(f.id)
         else coalesce(get_root_folder_owner(p.parent_id), p.created_by)
       end as owner_id,
       case
         when uf.entity_type = 'page' and exists (
           select 1 from workspace_members member
           where member.workspace_owner_id = coalesce(get_root_folder_owner(p.parent_id), p.created_by)
             and member.member_id = ${user.id}
             and not is_page_path_restricted(p.id)
         ) then 'workspace'
         when uf.entity_type = 'folder' and exists (
           select 1 from workspace_members member
           where member.workspace_owner_id = get_root_folder_owner(f.id)
             and member.member_id = ${user.id}
             and not is_folder_path_restricted(f.id)
         ) then 'workspace'
         when exists (
           select 1 from shares share
           where share.entity_type = uf.entity_type
             and share.entity_id = uf.entity_id
             and share.recipient_user_id = ${user.id}
         ) then 'direct'
         when uf.entity_type = 'page'
           and get_public_page_permission(p.id) is not null
           and exists (
             select 1 from page_public_access_visits visit
             where visit.page_id = p.id and visit.user_id = ${user.id}
           ) then 'public'
         when uf.entity_type = 'folder'
           and get_public_folder_permission(f.id) is not null
           and exists (
             select 1 from folder_public_access_visits visit
             where visit.folder_id = f.id and visit.user_id = ${user.id}
           ) then 'public'
         else null
       end as share_source,
       uf.created_at
     from user_stars uf
     left join pages p on p.id = uf.entity_id and uf.entity_type = 'page' and p.is_deleted = false
     left join folders f on f.id = uf.entity_id and uf.entity_type = 'folder' and f.is_deleted = false
     where uf.user_id = ${user.id}
       and ((uf.entity_type = 'page' and p.id is not null) or (uf.entity_type = 'folder' and f.id is not null))
       and case
         when uf.entity_type = 'folder' then exists (
           select 1 from get_effective_folder_permission(f.id, ${user.id}) access where access.permission is not null
         )
         else exists (
           select 1 from get_effective_page_permission(p.id, ${user.id}) access where access.permission is not null
         )
       end
     order by uf.created_at desc nulls last`,
  );

  const stars = result.rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    icon: row.icon,
    ownerId: row.owner_id,
    ...(row.share_source ? { shareSource: row.share_source } : {}),
    createdAt: row.created_at,
  }));

  return c.json({ stars });
});

starsRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new HTTPException(400, { message: 'Invalid body' });
  }

  const raw = body as { entityType?: unknown; entityId?: unknown };
  const entityType = parseEntityType(raw.entityType);
  if (typeof raw.entityId !== 'string' || !raw.entityId) {
    throw new HTTPException(400, { message: 'entityId is required' });
  }
  const entityId = raw.entityId;

  const existsResult = await query<{ id: string; is_deleted: boolean | null }>(
    entityType === 'page'
      ? sql`select id, is_deleted from pages where id = ${entityId} limit 1`
      : sql`select id, is_deleted from folders where id = ${entityId} limit 1`,
  );
  const entity = existsResult.rows[0];
  if (!entity || entity.is_deleted) {
    throw new HTTPException(404, {
      message: `${entityType === 'page' ? 'Page' : 'Folder'} not found`,
    });
  }

  const user = c.get('user');
  await ensureEntityAccess(entityType, entityId, user.id);

  const insertResult = await query(
    sql`insert into user_stars (user_id, entity_type, entity_id) values (${user.id}, ${entityType}, ${entityId}) on conflict (user_id, entity_type, entity_id) do nothing returning id`,
  );

  if (insertResult.rowCount === 0) {
    return c.json({ ok: true });
  }

  return c.json({ ok: true }, 201);
});

starsRoute.delete('/:entityType/:entityId', async (c) => {
  const entityType = parseEntityType(c.req.param('entityType'));
  const entityId = c.req.param('entityId');
  const user = c.get('user');

  await ensureEntityAccess(entityType, entityId, user.id);
  await query(
    sql`delete from user_stars where user_id = ${user.id} and entity_type = ${entityType} and entity_id = ${entityId}`,
  );

  return c.json({ deleted: true });
});

export default starsRoute;
