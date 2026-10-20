import { sql } from 'drizzle-orm';
import { query } from '../db/query';

/** Tokens shared with the ACL projection stored on each Meilisearch document. */
export async function getSearchAccessTokens(userId: string): Promise<string[]> {
  const memberships = await query<{ workspace_owner_id: string }>(sql`
    select workspace_owner_id
    from workspace_members
    where member_id = ${userId}
  `);

  return [
    `user:${userId}`,
    ...memberships.rows.map((membership) => `workspace:${membership.workspace_owner_id}`),
  ];
}
