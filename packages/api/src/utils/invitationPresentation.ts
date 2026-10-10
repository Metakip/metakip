import type { InvitationTargetType } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { resolveShareEntity } from './shareEntity';

export type InvitationPresentationTarget = {
  invited_by: string;
  target_id: string;
  target_type: InvitationTargetType;
};

export type InvitationPresentation = {
  targetTitle: string;
  inviterName: string;
};

export async function resolveInvitationPresentation(
  invitation: InvitationPresentationTarget,
  executor: QueryExecutor = db,
): Promise<InvitationPresentation> {
  const inviter = await executeQuery<{ name: string }>(
    executor,
    sql`select name from users where id = ${invitation.invited_by} limit 1`,
  );
  const inviterName = inviter.rows[0]?.name ?? 'Someone';

  if (invitation.target_type === 'workspace') {
    const owner = await executeQuery<{ name: string }>(
      executor,
      sql`select name from users where id = ${invitation.target_id} limit 1`,
    );
    const ownerName = owner.rows[0]?.name;
    if (!ownerName) throw new HTTPException(404, { message: 'Workspace not found' });
    return { inviterName, targetTitle: `${ownerName}'s workspace` };
  }

  try {
    const entity = await resolveShareEntity(invitation.target_type, invitation.target_id, executor);
    return { inviterName, targetTitle: entity.title };
  } catch (error) {
    if (!(error instanceof HTTPException) || error.status !== 404) throw error;
    return {
      inviterName,
      targetTitle: invitation.target_type === 'page' ? 'Unavailable page' : 'Unavailable folder',
    };
  }
}
