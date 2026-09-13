import type { ApiTokenScope } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db/connection';
import { executeQuery, query } from '../../db/query';
import { requireV1Auth, requireV1Session } from '../../middleware/v1Auth';
import { createApiTokenSecret } from '../../utils/apiTokens';
import { v1JsonBodyLimit } from './requestLimits';
import { parseJsonRequest } from './requestValidation';
import { createTokenRequestSchema, tokenOperations } from './tokenContracts';

type TokenListRow = {
  id: string;
  name: string;
  scopes: string[];
  expires_at: Date | string | null;
  last_used_at: Date | string | null;
  created_at: Date | string;
};

const toIso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

const tokensRoute = new Hono();
tokensRoute.use('*', requireV1Auth);
tokensRoute.use('*', requireV1Session);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

tokensRoute.get(tokenOperations.list.routePath, async (c) => {
  const principal = c.get('v1Principal');
  const result = await query<TokenListRow>(
    sql`select id, name, scopes, expires_at, last_used_at, created_at
        from api_tokens
        where user_id = ${principal.userId} and revoked_at is null
        order by created_at desc`,
  );
  return c.json({
    data: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      scopes: row.scopes,
      expiresAt: toIso(row.expires_at),
      lastUsedAt: toIso(row.last_used_at),
      createdAt: toIso(row.created_at),
    })),
  });
});

tokensRoute.post(tokenOperations.create.routePath, v1JsonBodyLimit, async (c) => {
  const principal = c.get('v1Principal');
  const candidate = await parseJsonRequest(c, createTokenRequestSchema);
  const name = candidate.name;
  const requestedScopes = candidate.scopes ?? ['pages:read'];
  const scopes = [...new Set(requestedScopes)] as ApiTokenScope[];
  if (!scopes.includes('pages:read')) scopes.unshift('pages:read');

  let expiresAt: Date | null = null;
  if (candidate.expiresAt !== undefined && candidate.expiresAt !== null) {
    expiresAt = new Date(candidate.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      throw new HTTPException(400, { message: 'expiresAt must be in the future' });
    }
  }

  const secret = createApiTokenSecret();
  const created = await db.transaction(async (tx) => {
    const result = await executeQuery<TokenListRow>(
      tx,
      sql`insert into api_tokens (id, user_id, name, token_hash, scopes, expires_at)
          values (${secret.id}, ${principal.userId}, ${name}, ${secret.tokenHash}, ${sql.param(scopes)}, ${expiresAt})
          returning id, name, scopes, expires_at, last_used_at, created_at`,
    );
    return result.rows[0];
  });
  if (!created) throw new HTTPException(500, { message: 'Failed to create token' });
  return c.json(
    {
      id: created.id,
      name: created.name,
      scopes: created.scopes,
      expiresAt: toIso(created.expires_at),
      lastUsedAt: toIso(created.last_used_at),
      createdAt: toIso(created.created_at),
      token: secret.token,
    },
    201,
  );
});

tokensRoute.delete(tokenOperations.revoke.routePath, async (c) => {
  const principal = c.get('v1Principal');
  const tokenId = c.req.param('id');
  if (!UUID_PATTERN.test(tokenId)) throw new HTTPException(400, { message: 'Invalid token ID' });
  const result = await query(
    sql`update api_tokens set revoked_at = now()
        where id = ${tokenId} and user_id = ${principal.userId} and revoked_at is null`,
  );
  if ((result.rowCount ?? 0) === 0) throw new HTTPException(404, { message: 'Token not found' });
  return c.body(null, 204);
});

export default tokensRoute;
