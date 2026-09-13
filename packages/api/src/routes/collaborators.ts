import { type CollaboratorDisplay, MAX_COLLABORATOR_ENTITY_IDS_PER_REQUEST } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { getRequestActor, persistGuestIdentity, type RequestActor } from '../utils/guestAccess';
import { lockEntityAccesses, type ShareEntityType } from '../utils/share-access';
import {
  getAccessors,
  getAccessSourcesByEntityIds,
  toCollaboratorDisplays,
} from '../utils/shareAccessors';

const collaboratorDisplayRoute = new Hono();

function parseIds(value: string | undefined): string[] {
  if (!value) return [];
  const ids = [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (ids.length > MAX_COLLABORATOR_ENTITY_IDS_PER_REQUEST) {
    throw new HTTPException(400, {
      message: `A maximum of ${MAX_COLLABORATOR_ENTITY_IDS_PER_REQUEST} entity IDs is allowed`,
    });
  }
  if (
    ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
  ) {
    throw new HTTPException(400, { message: 'Entity IDs must be UUIDs' });
  }
  return ids;
}

async function getAccessibleEntityIds(
  entityType: ShareEntityType,
  entityIds: readonly string[],
  actor: RequestActor,
  executor: QueryExecutor,
): Promise<string[]> {
  if (entityIds.length === 0) return [];
  const requestedIds = sql.join(
    entityIds.map((entityId) => sql`${entityId}`),
    sql`, `,
  );
  const result =
    actor.kind === 'user'
      ? entityType === 'page'
        ? await executeQuery<{ id: string }>(
            executor,
            sql`select requested.id
                from unnest(array[${requestedIds}]::uuid[]) requested(id)
                cross join lateral get_effective_page_permission(requested.id, ${actor.id}) access
                where access.permission is not null`,
          )
        : await executeQuery<{ id: string }>(
            executor,
            sql`select requested.id
                from unnest(array[${requestedIds}]::uuid[]) requested(id)
                cross join lateral get_effective_folder_permission(requested.id, ${actor.id}) access
                where access.permission is not null`,
          )
      : entityType === 'page'
        ? await executeQuery<{ id: string }>(
            executor,
            sql`select requested.id
                from unnest(array[${requestedIds}]::uuid[]) requested(id)
                where get_public_page_permission(requested.id) is not null`,
          )
        : await executeQuery<{ id: string }>(
            executor,
            sql`select requested.id
                from unnest(array[${requestedIds}]::uuid[]) requested(id)
                where get_public_folder_permission(requested.id) is not null`,
          );
  return result.rows.map((row) => row.id);
}

async function listCollaborators(
  entityType: ShareEntityType,
  entityIds: readonly string[],
  actor: RequestActor,
): Promise<Record<string, CollaboratorDisplay[]>> {
  return db.transaction(async (tx) => {
    let candidates = await getAccessibleEntityIds(entityType, entityIds, actor, tx);
    if (candidates.length > 0) {
      const lockedCandidates = await lockEntityAccesses(
        tx,
        candidates.map((entityId) => ({ entityType, entityId })),
        { missingEntities: 'omit' },
      );
      candidates = lockedCandidates.map((candidate) => candidate.entityId);
    }
    // Access can change while the workspace locks are being acquired. Resolve
    // it again under the lock before projecting any collaborator identities.
    const accessibleIds = await getAccessibleEntityIds(entityType, candidates, actor, tx);
    if (actor.kind === 'guest' && accessibleIds.length > 0) {
      await persistGuestIdentity(actor, tx);
    }
    const sourcesByEntity = await getAccessSourcesByEntityIds(entityType, accessibleIds, tx);
    return Object.fromEntries(
      entityIds.map((entityId) => [
        entityId,
        toCollaboratorDisplays(getAccessors(sourcesByEntity.get(entityId) ?? [])),
      ]),
    );
  });
}

collaboratorDisplayRoute.get('/pages/collaborators', async (c) => {
  const actor = await getRequestActor(c);
  return c.json(await listCollaborators('page', parseIds(c.req.query('ids')), actor));
});

collaboratorDisplayRoute.get('/folders/collaborators', async (c) => {
  const actor = await getRequestActor(c);
  return c.json(await listCollaborators('folder', parseIds(c.req.query('ids')), actor));
});

export default collaboratorDisplayRoute;
