import type { SharePermission } from '@metakip/shared';
import type { Pool } from 'pg';
import type { AuthenticatedCredential } from './authenticatedCredential';
import type { PermissionState } from './permissionState';

type PermissionQueryExecutor = Pick<Pool, 'query'>;

export type PagePermissionCandidate = {
  pageId: string;
  userId: string;
};

export type CredentialPagePermissionCandidate = PagePermissionCandidate & {
  credential: AuthenticatedCredential;
};

type SessionPagePermissionCandidate = PagePermissionCandidate & {
  credential: Extract<AuthenticatedCredential, { kind: 'session' }>;
};

type InternalPagePermissionCandidate = PagePermissionCandidate & {
  credential: Extract<AuthenticatedCredential, { kind: 'internal' }>;
};

export type PrincipalPagePermissionCandidate =
  | ({ kind: 'account' } & PagePermissionCandidate)
  | ({ kind: 'authenticated' } & CredentialPagePermissionCandidate)
  | { kind: 'anonymous'; pageId: string };

function normalizePermission(permission: string | null): SharePermission | null {
  return permission === 'admin' || permission === 'edit' || permission === 'view'
    ? permission
    : null;
}

export function accountPagePermissionKey(candidate: PagePermissionCandidate): string {
  return `${candidate.pageId}:${candidate.userId}`;
}

export function credentialPagePermissionKey(candidate: CredentialPagePermissionCandidate): string {
  return `${accountPagePermissionKey(candidate)}:${candidate.credential.kind}:${candidate.credential.raw}`;
}

export function principalPagePermissionKey(candidate: PrincipalPagePermissionCandidate): string {
  if (candidate.kind === 'anonymous') return `anonymous:${candidate.pageId}`;
  if (candidate.kind === 'account') return `account:${accountPagePermissionKey(candidate)}`;
  return `authenticated:${credentialPagePermissionKey(candidate)}`;
}

export async function queryAccountPagePermissions(
  pool: PermissionQueryExecutor,
  candidates: readonly PagePermissionCandidate[],
): Promise<Map<string, PermissionState>> {
  if (candidates.length === 0) return new Map();
  const result = await pool.query<{
    page_id: string;
    user_id: string;
    permission: string | null;
    access_revision: string;
  }>(
    `WITH requested_users AS (
       select distinct *
       from unnest($1::uuid[], $2::uuid[]) as candidate(page_id, user_id)
     )
     select requested_users.page_id, requested_users.user_id,
            access.permission,
            get_page_access_revision(requested_users.page_id)::text as access_revision
     from requested_users
     left join lateral get_effective_page_permission(
       requested_users.page_id,
       requested_users.user_id
     ) access on true`,
    [
      candidates.map((candidate) => candidate.pageId),
      candidates.map((candidate) => candidate.userId),
    ],
  );
  return new Map(
    result.rows.map((row) => [
      accountPagePermissionKey({ pageId: row.page_id, userId: row.user_id }),
      {
        permission: normalizePermission(row.permission),
        accessRevision: row.access_revision,
      },
    ]),
  );
}

type CredentialPermissionRow = {
  page_id: string;
  user_id: string;
  credential_raw: string;
  permission: string | null;
  access_revision: string;
};

function credentialCandidateKey(userId: string, raw: string): string {
  return `${userId}:${raw}`;
}

function mapCredentialPermissionRows(
  candidates: readonly CredentialPagePermissionCandidate[],
  rows: readonly CredentialPermissionRow[],
): Map<string, PermissionState> {
  const credentials = new Map(
    candidates.map((candidate) => [
      credentialCandidateKey(candidate.userId, candidate.credential.raw),
      candidate.credential,
    ]),
  );
  const states = new Map<string, PermissionState>();
  for (const row of rows) {
    const credential = credentials.get(credentialCandidateKey(row.user_id, row.credential_raw));
    if (!credential) continue;
    states.set(
      credentialPagePermissionKey({ pageId: row.page_id, userId: row.user_id, credential }),
      {
        permission: normalizePermission(row.permission),
        accessRevision: row.access_revision,
      },
    );
  }
  return states;
}

async function querySessionPagePermissions(
  pool: PermissionQueryExecutor,
  candidates: readonly SessionPagePermissionCandidate[],
): Promise<CredentialPermissionRow[]> {
  if (candidates.length === 0) return [];
  const result = await pool.query<CredentialPermissionRow>(
    `WITH requested_users AS (
       select distinct *
       from unnest($1::uuid[], $2::uuid[], $3::text[])
         as candidate(page_id, user_id, credential_raw)
     )
     select requested_users.page_id, requested_users.user_id,
            requested_users.credential_raw,
            case when is_active_session(
              requested_users.user_id,
              requested_users.credential_raw
            ) then access.permission else null end as permission,
            get_page_access_revision(requested_users.page_id)::text as access_revision
     from requested_users
     left join lateral get_effective_page_permission(
       requested_users.page_id,
       requested_users.user_id
     ) access on true`,
    [
      candidates.map((candidate) => candidate.pageId),
      candidates.map((candidate) => candidate.userId),
      candidates.map((candidate) => candidate.credential.raw),
    ],
  );
  return result.rows;
}

async function queryInternalPagePermissions(
  pool: PermissionQueryExecutor,
  candidates: readonly InternalPagePermissionCandidate[],
): Promise<Map<string, PermissionState>> {
  const accountStates = await queryAccountPagePermissions(pool, candidates);
  return new Map(
    candidates.flatMap((candidate) => {
      const state = accountStates.get(accountPagePermissionKey(candidate));
      return state ? [[credentialPagePermissionKey(candidate), state]] : [];
    }),
  );
}

export async function queryCredentialPagePermissions(
  pool: PermissionQueryExecutor,
  candidates: readonly CredentialPagePermissionCandidate[],
): Promise<Map<string, PermissionState>> {
  if (candidates.length === 0) return new Map();
  const sessions = candidates.filter(
    (candidate): candidate is SessionPagePermissionCandidate =>
      candidate.credential.kind === 'session',
  );
  const internal = candidates.filter(
    (candidate): candidate is InternalPagePermissionCandidate =>
      candidate.credential.kind === 'internal',
  );
  const [sessionRows, internalStates] = await Promise.all([
    querySessionPagePermissions(pool, sessions),
    queryInternalPagePermissions(pool, internal),
  ]);
  const states = mapCredentialPermissionRows(candidates, sessionRows);
  for (const [key, state] of internalStates) states.set(key, state);
  return states;
}

export async function queryAnonymousPagePermissions(
  pool: PermissionQueryExecutor,
  pageIds: readonly string[],
): Promise<Map<string, PermissionState>> {
  if (pageIds.length === 0) return new Map();
  const result = await pool.query<{
    page_id: string;
    permission: string | null;
    access_revision: string;
  }>(
    `with requested as (
       select distinct unnest($1::uuid[]) as page_id
     )
     select requested.page_id, get_public_page_permission(requested.page_id) as permission,
            get_page_access_revision(requested.page_id)::text as access_revision
     from requested`,
    [pageIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.page_id,
      {
        permission: normalizePermission(row.permission),
        accessRevision: row.access_revision,
      },
    ]),
  );
}

export async function queryPrincipalPagePermissions(
  pool: PermissionQueryExecutor,
  candidates: readonly PrincipalPagePermissionCandidate[],
): Promise<Map<string, PermissionState>> {
  const accounts = candidates.filter(
    (candidate): candidate is Extract<PrincipalPagePermissionCandidate, { kind: 'account' }> =>
      candidate.kind === 'account',
  );
  const authenticated = candidates.filter(
    (
      candidate,
    ): candidate is Extract<PrincipalPagePermissionCandidate, { kind: 'authenticated' }> =>
      candidate.kind === 'authenticated',
  );
  const anonymousPageIds = candidates.flatMap((candidate) =>
    candidate.kind === 'anonymous' ? [candidate.pageId] : [],
  );
  const [accountStates, credentialStates, anonymousStates] = await Promise.all([
    queryAccountPagePermissions(pool, accounts),
    queryCredentialPagePermissions(pool, authenticated),
    queryAnonymousPagePermissions(pool, anonymousPageIds),
  ]);
  const result = new Map<string, PermissionState>();
  for (const candidate of candidates) {
    const state =
      candidate.kind === 'anonymous'
        ? anonymousStates.get(candidate.pageId)
        : candidate.kind === 'account'
          ? accountStates.get(accountPagePermissionKey(candidate))
          : credentialStates.get(credentialPagePermissionKey(candidate));
    if (state) result.set(principalPagePermissionKey(candidate), state);
  }
  return result;
}
