import type { InheritancePolicy, PublicPermission, ShareEntityType } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';

export type ShareEntity = {
  id: string;
  ownerId: string | null;
  title: string;
  inheritancePolicy: InheritancePolicy;
  publicPermission: PublicPermission | null;
};

export type OwnedShareEntity = Omit<ShareEntity, 'ownerId'> & { ownerId: string };

export async function resolveShareEntity(
  entityType: ShareEntityType,
  entityId: string,
  executor: QueryExecutor = db,
): Promise<ShareEntity> {
  const result =
    entityType === 'page'
      ? await executeQuery<{
          id: string;
          owner_id: string | null;
          title: string;
          inheritance_policy: InheritancePolicy;
          public_permission: PublicPermission | null;
        }>(
          executor,
          sql`select page.id,
                  coalesce(get_root_folder_owner(page.parent_id), page.created_by) as owner_id,
                  page.title, page.inheritance_policy, page.public_permission
              from pages page
              where page.id = ${entityId} and page.is_deleted = false`,
        )
      : await executeQuery<{
          id: string;
          owner_id: string | null;
          title: string;
          inheritance_policy: InheritancePolicy;
          public_permission: PublicPermission | null;
        }>(
          executor,
          sql`select folder.id, get_root_folder_owner(folder.id) as owner_id,
                  folder.name as title, folder.inheritance_policy, folder.public_permission
              from folders folder
              where folder.id = ${entityId} and folder.is_deleted = false`,
        );
  const entity = result.rows[0];
  if (!entity) {
    throw new HTTPException(404, {
      message: entityType === 'page' ? 'Page not found' : 'Folder not found',
    });
  }
  return {
    id: entity.id,
    ownerId: entity.owner_id,
    title: entity.title,
    inheritancePolicy: entity.inheritance_policy,
    publicPermission: entity.public_permission,
  };
}

export async function resolveOwnedShareEntity(
  entityType: ShareEntityType,
  entityId: string,
  executor: QueryExecutor = db,
): Promise<OwnedShareEntity> {
  const entity = await resolveShareEntity(entityType, entityId, executor);
  if (!entity.ownerId) throw new HTTPException(409, { message: 'Entity owner is unavailable' });
  return { ...entity, ownerId: entity.ownerId };
}
