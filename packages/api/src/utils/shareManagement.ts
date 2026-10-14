import {
  buildFolderPath,
  buildPagePath,
  deriveCapabilities,
  type EntityAccessSource,
  type EntityShare,
  type InheritancePolicy,
  type InheritedPublicAccess,
  type PublicPermission,
  type ShareSummary,
} from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor, query } from '../db/query';
import { getEnumerableFolderIds } from './folderEnumeration';
import { listPendingInvitations, normalizeInvitationEmail } from './pendingInvitations';
import { buildPublicWebUrl } from './publicWebUrl';
import {
  ensureCanAdminEntity,
  ensureFolderAccess,
  ensurePageAccess,
  lockEntityAccess,
  lockEntityAccessMutation,
  type ShareEntityType,
  type SharePermission,
} from './share-access';
import { notifyShareRecompute, notifyShareRevoke, notifyShareUpdate } from './share-notify';
import { getAccessors, getAccessSources, toCollaboratorDisplays } from './shareAccessors';
import { resolveShareEntity } from './shareEntity';
import { getEntityMetaUserIds, mergeMetaUserIds } from './shareRecipients';
import { toIsoTimestamp } from './toIsoTimestamp';

type DirectGrantRow = {
  id: string;
  entity_type: ShareEntityType;
  entity_id: string;
  permission: SharePermission;
  recipient_user_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  recipient_avatar_url: string | null;
  shared_by_name: string | null;
  shared_by_email: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

const buildEntityUrl = (type: ShareEntityType, title: string, id: string) =>
  buildPublicWebUrl(type === 'page' ? buildPagePath(title, id) : buildFolderPath(title, id));

async function getDirectGrants(
  entityType: ShareEntityType,
  entityId: string,
  executor: QueryExecutor,
): Promise<EntityShare[]> {
  const result = await executeQuery<DirectGrantRow>(
    executor,
    sql`select share.id, share.entity_type, share.entity_id, share.permission,
            share.recipient_user_id, recipient.email as recipient_email,
            recipient.name as recipient_name,
            coalesce(recipient.avatar_url, recipient.image) as recipient_avatar_url,
            sharer.name as shared_by_name, sharer.email as shared_by_email,
            share.created_at, share.updated_at
     from shares share
     join users recipient on recipient.id = share.recipient_user_id
     left join users sharer on sharer.id = share.shared_by
     where share.entity_type = ${entityType} and share.entity_id = ${entityId}
     order by lower(coalesce(recipient.name, recipient.email)), share.created_at`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    permission: row.permission,
    recipientUserId: row.recipient_user_id,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    recipientAvatarUrl: row.recipient_avatar_url,
    sharedByName: row.shared_by_name,
    sharedByEmail: row.shared_by_email,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  }));
}

async function getInheritedPublicAccess(
  entityType: ShareEntityType,
  entityId: string,
  executor: QueryExecutor,
): Promise<InheritedPublicAccess[]> {
  const result =
    entityType === 'page'
      ? await executeQuery<{
          entity_id: string;
          entity_title: string;
          permission: PublicPermission;
        }>(
          executor,
          sql`select folder.id as entity_id, folder.name as entity_title,
                  folder.public_permission as permission
           from pages page
           join folder_closure path on path.descendant_id = page.parent_id
           join folders folder on folder.id = path.ancestor_id
           where page.id = ${entityId} and page.is_deleted = false
             and folder.is_deleted = false
             and folder.public_permission is not null
             and not is_page_folder_inheritance_blocked(folder.id, page.id)
           order by case folder.public_permission when 'edit' then 2 else 1 end desc,
                    path.depth asc`,
        )
      : await executeQuery<{
          entity_id: string;
          entity_title: string;
          permission: PublicPermission;
        }>(
          executor,
          sql`select folder.id as entity_id, folder.name as entity_title,
                  folder.public_permission as permission
           from folder_closure path
           join folders folder on folder.id = path.ancestor_id
           where path.descendant_id = ${entityId} and path.depth > 0
             and folder.is_deleted = false
             and folder.public_permission is not null
             and not is_folder_inheritance_blocked(folder.id, ${entityId})
           order by case folder.public_permission when 'edit' then 2 else 1 end desc,
                    path.depth asc`,
        );
  return result.rows.map((row) => ({
    entityId: row.entity_id,
    entityTitle: row.entity_title,
    permission: row.permission,
    url: buildEntityUrl('folder', row.entity_title, row.entity_id),
  }));
}

export async function getShareSummary(
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
): Promise<ShareSummary> {
  return db.transaction(async (tx) => {
    await lockEntityAccess(tx, entityType, entityId);
    const entity = await resolveShareEntity(entityType, entityId, tx);
    const access =
      entityType === 'page'
        ? await ensurePageAccess(entityId, userId, 'view', tx)
        : await ensureFolderAccess(entityId, userId, 'view', tx);
    const hasManagementAccess = access.fullAccess || access.permission === 'admin';
    const publicAccess = {
      permission: entity.publicPermission ?? ('private' as const),
      url: buildEntityUrl(entityType, entity.title, entity.id),
    };

    if (!hasManagementAccess) {
      const sources = await getAccessSources(entityType, entityId, tx);
      return {
        visibility: 'limited',
        collaborators: toCollaboratorDisplays(getAccessors(sources)),
        entity: { type: entityType, id: entity.id, title: entity.title, ownerId: null },
        publicAccess,
        inheritance: { policy: 'inherit' },
        grants: [],
        pendingInvitations: [],
        accessors: [],
        accessSources: [],
        inheritedPublicAccess: [],
        userPermission: access.permission,
        capabilities: deriveCapabilities(access.permission, access.fullAccess),
        permissionDetails: [],
        inheritedAccessors: [],
      };
    }

    const [grants, sources, inheritedPublicAccess, pendingInvitations] = await Promise.all([
      getDirectGrants(entityType, entityId, tx),
      getAccessSources(entityType, entityId, tx),
      getInheritedPublicAccess(entityType, entityId, tx),
      listPendingInvitations(entityType, entityId, tx, {
        actorId: userId,
        fullAccess: access.fullAccess,
      }),
    ]);
    const enumerableFolders = await getEnumerableFolderIds(userId, tx);
    const visibleSources = sources.map((source) => {
      if (!source.folderId || enumerableFolders.has(source.folderId)) return source;
      const redacted = { ...source, grantId: null };
      delete redacted.folderId;
      delete redacted.folderName;
      return redacted;
    });
    const accessors = getAccessors(visibleSources);
    const userSources = visibleSources.filter((source) => source.userId === userId);

    return {
      visibility: 'full',
      collaborators: toCollaboratorDisplays(accessors),
      entity: { type: entityType, id: entity.id, title: entity.title, ownerId: entity.ownerId },
      publicAccess,
      inheritance: { policy: entity.inheritancePolicy },
      grants,
      pendingInvitations,
      accessors,
      accessSources: visibleSources,
      inheritedPublicAccess: inheritedPublicAccess.filter((item) =>
        enumerableFolders.has(item.entityId),
      ),
      userPermission: access.permission,
      capabilities: deriveCapabilities(access.permission, access.fullAccess),
      permissionDetails: userSources.map((source) => ({
        source:
          source.kind === 'direct'
            ? ('grant' as const)
            : source.kind === 'owner'
              ? ('owner' as const)
              : source.kind,
        permission: source.permission,
        ...(source.folderId ? { folderId: source.folderId, folderName: source.folderName } : {}),
      })),
      inheritedAccessors: visibleSources
        .filter(
          (source): source is EntityAccessSource & { kind: 'folder' | 'workspace' } =>
            source.kind === 'folder' || source.kind === 'workspace',
        )
        .map((source) => ({
          userId: source.userId,
          name: source.name,
          email: source.email,
          permission: source.permission,
          source: source.kind,
          ...(source.folderId ? { folderId: source.folderId, folderName: source.folderName } : {}),
        })),
    };
  });
}

export async function updateSharingInheritance(
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
  policy: InheritancePolicy,
): Promise<{ policy: InheritancePolicy; message: string }> {
  const entity = await resolveShareEntity(entityType, entityId);
  await ensureCanAdminEntity(entityType, entityId, userId);
  const message =
    policy === 'restricted'
      ? `${entity.title} stopped inheriting access`
      : `${entity.title} now inherits access`;

  await db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, entityType, entityId);
    await ensureCanAdminEntity(entityType, entityId, userId, tx);
    const affectedBefore = await getEntityMetaUserIds(tx, entityType, entityId);
    await executeQuery(
      tx,
      entityType === 'page'
        ? sql`update pages set inheritance_policy = ${policy}, updated_at = now() where id = ${entityId}`
        : sql`update folders set inheritance_policy = ${policy}, updated_at = now() where id = ${entityId}`,
    );
    const affectedAfter = await getEntityMetaUserIds(tx, entityType, entityId);
    await notifyShareRecompute(
      {
        entityType,
        entityId,
        metaUserIds: mergeMetaUserIds(affectedBefore, affectedAfter),
        message,
      },
      tx,
    );
  });

  return { policy, message };
}

export async function updatePublicAccess(
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
  permission: PublicPermission | null,
): Promise<{ permission: PublicPermission | 'private'; url: string; message: string }> {
  const entity = await resolveShareEntity(entityType, entityId);
  await ensureCanAdminEntity(entityType, entityId, userId);
  const message =
    permission === null
      ? `Public access removed for ${entity.title}`
      : permission === 'view'
        ? `${entity.title} is now public view only`
        : `${entity.title} is now publicly editable`;

  await db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, entityType, entityId);
    await ensureCanAdminEntity(entityType, entityId, userId, tx);
    const affectedBefore = await getEntityMetaUserIds(tx, entityType, entityId);
    await executeQuery(
      tx,
      entityType === 'page'
        ? sql`update pages set public_permission = ${permission}, updated_at = now() where id = ${entityId}`
        : sql`update folders set public_permission = ${permission}, updated_at = now() where id = ${entityId}`,
    );

    if (permission === null) {
      if (entityType === 'page') {
        await executeQuery(
          tx,
          sql`delete from page_public_access_visits visit
           where visit.page_id = ${entityId} and get_public_page_permission(visit.page_id) is null`,
        );
      } else {
        await executeQuery(
          tx,
          sql`delete from folder_public_access_visits visit
           where visit.folder_id in (
             select descendant_id from folder_closure where ancestor_id = ${entityId}
           )`,
        );
        await executeQuery(
          tx,
          sql`delete from page_public_access_visits visit
           using pages page, folder_closure path
           where visit.page_id = page.id
             and path.ancestor_id = ${entityId} and path.descendant_id = page.parent_id`,
        );
      }
    }

    const affectedAfter = await getEntityMetaUserIds(tx, entityType, entityId);
    const notification = {
      entityType,
      entityId,
      metaUserIds: mergeMetaUserIds(affectedBefore, affectedAfter),
      message,
    };
    if (permission === null) {
      await notifyShareRevoke(notification, tx);
    } else {
      await notifyShareUpdate({ ...notification, permission }, tx);
    }
  });

  return {
    permission: permission ?? 'private',
    url: buildEntityUrl(entityType, entity.title, entity.id),
    message,
  };
}

type GrantSelector = { grantId: string } | { email: string };
type LockedGrant = {
  id: string;
  permission: SharePermission;
  recipient_user_id: string;
  recipient_email: string;
};

async function findGrantTarget(
  grantId: string,
): Promise<{ entityType: ShareEntityType; entityId: string }> {
  const result = await query<{ entity_type: ShareEntityType; entity_id: string }>(
    sql`select entity_type, entity_id from shares where id = ${grantId}`,
  );
  const grant = result.rows[0];
  if (!grant) throw new HTTPException(404, { message: 'Grant not found' });
  return { entityType: grant.entity_type, entityId: grant.entity_id };
}

async function lockMatchingGrant(
  tx: QueryExecutor,
  entityType: ShareEntityType,
  entityId: string,
  selector: GrantSelector,
): Promise<LockedGrant> {
  const matching =
    'grantId' in selector
      ? sql`share.id = ${selector.grantId}`
      : sql`lower(recipient.email) = ${selector.email}`;
  const result = await executeQuery<LockedGrant>(
    tx,
    sql`select share.id, share.permission, share.recipient_user_id,
               recipient.email as recipient_email
        from shares share
        join users recipient on recipient.id = share.recipient_user_id
        where share.entity_type = ${entityType} and share.entity_id = ${entityId}
          and ${matching}
        for update of share`,
  );
  if (result.rows.length > 1) {
    throw new HTTPException(409, { message: 'More than one direct share matches this email' });
  }
  const grant = result.rows[0];
  if (!grant) {
    if ('email' in selector) {
      const pending = await executeQuery(
        tx,
        sql`select 1 from pending_invitations invitation
            where invitation.target_type = ${entityType} and invitation.target_id = ${entityId}
              and invitation.email = ${selector.email}
              and get_invitation_claim_status(invitation) = 'pending'`,
      );
      if (pending.rows.length > 0) {
        throw new HTTPException(409, {
          message: 'This person has a pending invitation; use resend or cancel instead',
        });
      }
    }
    throw new HTTPException(404, { message: 'Grant not found' });
  }
  return grant;
}

async function updateMatchingGrant(
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
  selector: GrantSelector,
  permission: SharePermission,
): Promise<{ message: string }> {
  return db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, entityType, entityId);
    const actorAccess = await ensureCanAdminEntity(entityType, entityId, userId, tx);
    const entity = await resolveShareEntity(entityType, entityId, tx);
    const grant = await lockMatchingGrant(tx, entityType, entityId, selector);
    if ((grant.permission === 'admin' || permission === 'admin') && !actorAccess.fullAccess) {
      throw new HTTPException(403, { message: 'Only the owner can grant or change admin access' });
    }
    await executeQuery(
      tx,
      sql`update shares set permission = ${permission}, updated_at = now() where id = ${grant.id}`,
    );
    await notifyShareUpdate(
      { entityType, entityId, permission, targetUserId: grant.recipient_user_id },
      tx,
    );
    return {
      message: `Updated ${grant.recipient_email}’s access to ${permission} on ${entity.title}`,
    };
  });
}

export async function updateShareGrantPermission(
  grantId: string,
  userId: string,
  permission: SharePermission,
): Promise<{ message: string }> {
  const { entityType, entityId } = await findGrantTarget(grantId);
  return updateMatchingGrant(entityType, entityId, userId, { grantId }, permission);
}

export function updateShareGrantPermissionByEmail(
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
  email: string,
  permission: SharePermission,
): Promise<{ message: string }> {
  return updateMatchingGrant(
    entityType,
    entityId,
    userId,
    { email: normalizeInvitationEmail(email) },
    permission,
  );
}

async function revokeMatchingGrant(
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
  selector: GrantSelector,
): Promise<{ message: string }> {
  return db.transaction(async (tx) => {
    await lockEntityAccessMutation(tx, entityType, entityId);
    // Email-based removal is a management operation; ID-based removal also allows
    // recipients to remove their own direct share.
    const managementAccess =
      'email' in selector ? await ensureCanAdminEntity(entityType, entityId, userId, tx) : null;
    const entity = await resolveShareEntity(entityType, entityId, tx);
    const grant = await lockMatchingGrant(tx, entityType, entityId, selector);
    const selfRemoval = 'grantId' in selector && grant.recipient_user_id === userId;
    const actorAccess = selfRemoval
      ? null
      : (managementAccess ?? (await ensureCanAdminEntity(entityType, entityId, userId, tx)));
    if (!selfRemoval && grant.permission === 'admin' && !actorAccess?.fullAccess) {
      throw new HTTPException(403, { message: 'Only the owner can remove an admin' });
    }
    await executeQuery(tx, sql`delete from shares where id = ${grant.id}`);
    await notifyShareRevoke(
      {
        entityType,
        entityId,
        targetUserId: grant.recipient_user_id,
        ...(selfRemoval && entity.ownerId ? { metaUserIds: [entity.ownerId] } : {}),
      },
      tx,
    );
    return {
      message: selfRemoval
        ? `Removed ${entity.title} from your view`
        : `Removed ${grant.recipient_email}’s access to ${entity.title}`,
    };
  });
}

export async function revokeShareGrant(
  grantId: string,
  userId: string,
): Promise<{ message: string }> {
  const { entityType, entityId } = await findGrantTarget(grantId);
  return revokeMatchingGrant(entityType, entityId, userId, { grantId });
}

export function revokeShareGrantByEmail(
  entityType: ShareEntityType,
  entityId: string,
  userId: string,
  email: string,
): Promise<{ message: string }> {
  return revokeMatchingGrant(entityType, entityId, userId, {
    email: normalizeInvitationEmail(email),
  });
}
