import type { ApiTokenAuditOperation, ApiTokenAuditResult } from '@markdawn/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// Custom bytea type for binary data
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return 'bytea';
  },
});

const tsvector = customType<{ data: string; notNull: false; default: false }>({
  dataType() {
    return 'tsvector';
  },
});

// ======================
// Better Auth Tables
// ======================

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
    expiresAt: timestamp('expires_at'),
    token: text('token').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    tokenIdx: index('sessions_token_idx').on(table.token),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    issuer: text('issuer').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => ({
    issuerAccountUnique: unique('accounts_issuer_account_id_unique').on(
      table.issuer,
      table.accountId,
    ),
  }),
);

export const verifications = pgTable('verifications', {
  id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at').notNull(),
});

// ======================
// App Tables
// ======================

export const dataMigrations = pgTable('data_migrations', {
  name: text('name').primaryKey(),
  completedAt: timestamp('completed_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  emailVerified: boolean('email_verified').default(false),
  image: text('image'),
  avatarUrl: text('avatar_url'),
  onboardingCompletedAt: timestamp('onboarding_completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    scopes: text('scopes').array().notNull().default(sql`array['pages:read']::text[]`),
    expiresAt: timestamp('expires_at'),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index('api_tokens_user_idx').on(table.userId),
    tokenHashUnique: unique('api_tokens_token_hash_unique').on(table.tokenHash),
    nameLength: check('api_tokens_name_length_check', sql`char_length(${table.name}) <= 100`),
  }),
);

// Better Auth OAuth/MCP tables. These use Better Auth's model names while
// retaining this repository's existing UUID user identifiers.
export const jwks = pgTable('jwks', {
  id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
  alg: text('alg'),
  crv: text('crv'),
});

export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    clientDiscoveryId: text('client_discovery_id'),
    disabled: boolean('disabled').default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: text('scopes').array(),
    clientCredentialsScopes: text('client_credentials_scopes').array(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').array().notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
    backchannelLogoutUri: text('backchannel_logout_uri'),
    backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    applicationType: text('application_type'),
    jwks: text('jwks'),
    jwksUri: text('jwks_uri'),
    grantTypes: text('grant_types').array(),
    responseTypes: text('response_types').array(),
    requirePKCE: boolean('require_pkce'),
    dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').default(false),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata'),
  },
  (table) => ({
    userIdx: index('oauth_clients_user_id_idx').on(table.userId),
  }),
);

export const oauthResources = pgTable('oauth_resources', {
  id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: text('allowed_scopes').array(),
  customClaims: jsonb('custom_claims'),
  dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required').default(false),
  disabled: boolean('disabled').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  policyVersion: integer('policy_version').default(1),
  metadata: jsonb('metadata'),
});

export const oauthClientResources = pgTable(
  'oauth_client_resources',
  {
    id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: 'cascade' }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    pairUnique: unique('oauth_client_resources_client_resource_unique').on(
      table.clientId,
      table.resourceId,
    ),
    clientIdx: index('oauth_client_resources_client_id_idx').on(table.clientId),
    resourceIdx: index('oauth_client_resources_resource_id_idx').on(table.resourceId),
  }),
);

export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
    revoked: timestamp('revoked'),
    rotatedAt: timestamp('rotated_at'),
    rotationReplayResponse: text('rotation_replay_response'),
    rotationReplayExpiresAt: timestamp('rotation_replay_expires_at'),
    authTime: timestamp('auth_time'),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (table) => ({
    clientIdx: index('oauth_refresh_tokens_client_id_idx').on(table.clientId),
    sessionIdx: index('oauth_refresh_tokens_session_id_idx').on(table.sessionId),
    userIdx: index('oauth_refresh_tokens_user_id_idx').on(table.userId),
    authorizationCodeIdx: index('oauth_refresh_tokens_authorization_code_id_idx').on(
      table.authorizationCodeId,
    ),
  }),
);

export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
    token: text('token').unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId),
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    refreshId: text('refresh_id').references(() => oauthRefreshTokens.id),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
    revoked: timestamp('revoked'),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (table) => ({
    clientIdx: index('oauth_access_tokens_client_id_idx').on(table.clientId),
    sessionIdx: index('oauth_access_tokens_session_id_idx').on(table.sessionId),
    userIdx: index('oauth_access_tokens_user_id_idx').on(table.userId),
    authorizationCodeIdx: index('oauth_access_tokens_authorization_code_id_idx').on(
      table.authorizationCodeId,
    ),
    refreshIdx: index('oauth_access_tokens_refresh_id_idx').on(table.refreshId),
  }),
);

export const oauthConsents = pgTable(
  'oauth_consents',
  {
    id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId),
    userId: uuid('user_id').references(() => users.id),
    referenceId: text('reference_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => ({
    clientIdx: index('oauth_consents_client_id_idx').on(table.clientId),
    userIdx: index('oauth_consents_user_id_idx').on(table.userId),
  }),
);

export const oauthClientAssertions = pgTable(
  'oauth_client_assertions',
  {
    id: text('id').default(sql`gen_random_uuid()::text`).primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (table) => ({
    expiresAtIdIdx: index('oauth_client_assertions_expires_at_id_idx').on(
      table.expiresAt,
      table.id,
    ),
  }),
);

export const oauthAccessTokenRevocations = pgTable(
  'oauth_access_token_revocations',
  {
    tokenHash: text('token_hash').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at').defaultNow().notNull(),
  },
  (table) => ({
    expiresAtIdx: index('oauth_access_token_revocations_expires_at_idx').on(
      table.expiresAt,
      table.tokenHash,
    ),
  }),
);

export const workspaceAccessVersions = pgTable('workspace_access_versions', {
  workspaceOwnerId: uuid('workspace_owner_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  version: bigint('version', { mode: 'bigint' }).notNull().default(0n),
});

export const shares = pgTable(
  'shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityType: text('entity_type').notNull().$type<'folder' | 'page'>(),
    entityId: uuid('entity_id').notNull(),
    sharedBy: uuid('shared_by').references(() => users.id, { onDelete: 'set null' }),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull().default('view').$type<'view' | 'edit' | 'admin'>(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    entityIdx: index('shares_entity_idx').on(table.entityType, table.entityId),
    recipientIdx: index('shares_recipient_idx').on(table.recipientUserId),
    recipientUnique: unique('shares_recipient_unique').on(
      table.entityType,
      table.entityId,
      table.recipientUserId,
    ),
  }),
);

export const pagePublicAccessVisits = pgTable(
  'page_public_access_visits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id')
      .references(() => pages.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    firstSeenAt: timestamp('first_seen_at').defaultNow(),
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
  },
  (table) => ({
    pageUserUnique: unique('page_public_access_visits_page_user_unique').on(
      table.pageId,
      table.userId,
    ),
    userIdx: index('page_public_access_visits_user_idx').on(table.userId),
  }),
);

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull().default('New Folder'),
    icon: text('icon'),
    position: text('position').notNull().default('0'),

    createdBy: uuid('created_by').references(() => users.id),

    createdAt: timestamp('created_at').defaultNow(),

    updatedAt: timestamp('updated_at').defaultNow(),

    isDeleted: boolean('is_deleted').default(false),

    deletedAt: timestamp('deleted_at'),

    deletionBatchId: uuid('deletion_batch_id'),

    publicPermission: text('public_permission').$type<'view' | 'edit'>(),

    inheritancePolicy: text('inheritance_policy')
      .notNull()
      .default('inherit')
      .$type<'inherit' | 'restricted'>(),
  },
  (table) => ({
    nameLength: check('folders_name_length_check', sql`char_length(${table.name}) <= 250`),
    positionNumeric: check(
      'folders_position_numeric_check',
      sql`char_length(${table.position}) <= 128 and ${table.position} ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$'`,
    ),
    publicPermission: check(
      'folders_public_permission_check',
      sql`${table.publicPermission} is null or ${table.publicPermission} in ('view', 'edit')`,
    ),
  }),
);

export const folderClosure = pgTable(
  'folder_closure',
  {
    ancestorId: uuid('ancestor_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'cascade' }),
    descendantId: uuid('descendant_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'cascade' }),
    depth: integer('depth').notNull(),
  },
  (table) => ({
    pk: unique('folder_closure_pk').on(table.ancestorId, table.descendantId),
    descendantIdx: index('folder_closure_descendant_idx').on(table.descendantId),
    ancestorIdx: index('folder_closure_ancestor_idx').on(table.ancestorId),
  }),
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceOwnerId: uuid('workspace_owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('editor').$type<'viewer' | 'editor' | 'admin'>(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    ownerMemberUnique: unique('workspace_members_owner_member_unique').on(
      table.workspaceOwnerId,
      table.memberId,
    ),
  }),
);

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    parentId: uuid('parent_id').references(() => folders.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('Untitled'),
    titleRevision: bigint('title_revision', { mode: 'bigint' }).notNull().default(0n),
    titleSearch: tsvector('title_search'),
    contentSearch: text('content_search'),
    icon: text('icon'),
    coverType: text('cover_type'),
    coverValue: text('cover_value'),
    position: text('position').notNull().default('0'),
    ydoc: bytea('ydoc'),
    properties: customType<{ data: Record<string, unknown>; notNull: false; default: false }>({
      dataType() {
        return 'jsonb';
      },
    })('properties'),

    createdBy: uuid('created_by').references(() => users.id),

    publicPermission: text('public_permission').$type<'view' | 'edit'>(),

    inheritancePolicy: text('inheritance_policy')
      .notNull()
      .default('inherit')
      .$type<'inherit' | 'restricted'>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),

    updatedAt: timestamp('updated_at').defaultNow().notNull(),

    isDeleted: boolean('is_deleted').default(false),

    deletedAt: timestamp('deleted_at'),

    deletionBatchId: uuid('deletion_batch_id'),
  },
  (table) => ({
    titleExactIdx: index('pages_title_exact_idx').on(sql`lower(${table.title})`),
    titleSearchIdx: index('pages_title_search_idx').using('gin', table.titleSearch),
    titleLength: check('pages_title_length_check', sql`char_length(${table.title}) <= 250`),
    positionNumeric: check(
      'pages_position_numeric_check',
      sql`char_length(${table.position}) <= 128 and ${table.position} ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$'`,
    ),
    publicPermission: check(
      'pages_public_permission_check',
      sql`${table.publicPermission} is null or ${table.publicPermission} in ('view', 'edit')`,
    ),
  }),
);

export const apiTokenAuditEvents = pgTable(
  'api_token_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenId: uuid('token_id').references(() => apiTokens.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
    operation: text('operation').notNull().$type<ApiTokenAuditOperation>(),
    result: text('result').notNull().$type<ApiTokenAuditResult>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('api_token_audit_events_created_at_idx').on(table.createdAt),
    tokenCreatedIdx: index('api_token_audit_events_token_created_idx').on(
      table.tokenId,
      table.createdAt,
    ),
    ownerIdx: index('api_token_audit_events_owner_idx').on(table.ownerId),
    pageIdx: index('api_token_audit_events_page_idx').on(table.pageId),
  }),
);

export const apiIdempotencyRecords = pgTable(
  'api_idempotency_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    principalKey: text('principal_key').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    response: customType<{ data: Record<string, unknown>; notNull: false; default: false }>({
      dataType() {
        return 'jsonb';
      },
    })('response'),
    etag: text('etag'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    principalKeyUnique: unique('api_idempotency_records_principal_key_unique').on(
      table.principalKey,
      table.idempotencyKey,
    ),
    keyLength: check(
      'api_idempotency_records_key_length_check',
      sql`char_length(${table.idempotencyKey}) between 1 and 200`,
    ),
    expiryIdx: index('api_idempotency_records_expires_at_idx').on(table.expiresAt),
  }),
);

export const pageVersions = pgTable(
  'page_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    content: customType<{ data: unknown; notNull: true; default: false }>({
      dataType() {
        return 'jsonb';
      },
    })('content').notNull(),
    title: text('title'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    titleLength: check(
      'page_versions_title_length_check',
      sql`${table.title} is null or char_length(${table.title}) <= 250`,
    ),
  }),
);

export const userFavorites = pgTable(
  'user_favorites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull().default('page').$type<'folder' | 'page'>(),
    entityId: uuid('entity_id').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    userEntityUnique: unique().on(table.userId, table.entityType, table.entityId),
    entityIdx: index('user_favorites_entity_idx').on(table.entityType, table.entityId),
  }),
);

export const pageVisits = pgTable(
  'page_visits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    visitedAt: timestamp('visited_at').defaultNow(),
  },
  (table) => ({
    userPageUnique: unique().on(table.userId, table.pageId),
  }),
);

export const folderPublicAccessVisits = pgTable(
  'folder_public_access_visits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    folderId: uuid('folder_id')
      .references(() => folders.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    firstSeenAt: timestamp('first_seen_at').defaultNow(),
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
  },
  (table) => ({
    folderUserUnique: unique('folder_public_access_visits_folder_user_unique').on(
      table.folderId,
      table.userId,
    ),
    userIdx: index('folder_public_access_visits_user_idx').on(table.userId),
  }),
);

export const guestIdentities = pgTable(
  'guest_identities',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => ({
    lastSeenIdx: index('guest_identities_last_seen_idx').on(table.lastSeenAt),
  }),
);

export const guestIdentityTombstones = pgTable(
  'guest_identity_tombstones',
  {
    id: uuid('id').primaryKey(),
    expiredAt: timestamp('expired_at').defaultNow().notNull(),
  },
  (table) => ({
    expiredAtIdx: index('guest_identity_tombstones_expired_at_idx').on(table.expiredAt),
  }),
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    guestId: uuid('guest_id').references(() => guestIdentities.id),
    content: text('content').notNull(),
    anchorBlockId: text('anchor_block_id'),
    resolved: boolean('resolved').default(false),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    author: check(
      'comments_author_check',
      sql`num_nonnulls(${table.userId}, ${table.guestId}) = 1`,
    ),
  }),
);

export const templates = pgTable('templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  icon: text('icon'),
  description: text('description'),
  contentBlocks: customType<{ data: unknown; notNull: true; default: false }>({
    dataType() {
      return 'jsonb';
    },
  })('content_blocks').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const commentReplies = pgTable(
  'comment_replies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    guestId: uuid('guest_id').references(() => guestIdentities.id),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    author: check(
      'comment_replies_author_check',
      sql`num_nonnulls(${table.userId}, ${table.guestId}) = 1`,
    ),
  }),
);

export const connections = pgTable(
  'connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceType: text('source_type').notNull().default('page'),
    sourceId: uuid('source_id')
      .references(() => pages.id, { onDelete: 'cascade' })
      .notNull(),
    targetType: text('target_type').notNull().$type<'page' | 'tag' | 'user' | 'external'>(),
    targetId: uuid('target_id'),
    targetSlug: text('target_slug').notNull(),
    targetLabel: text('target_label').notNull(),
    connectionType: text('connection_type')
      .notNull()
      .$type<'wikilink' | 'tag' | 'mention' | 'embed' | 'heading' | 'url'>(),
    linkText: text('link_text'),
    linkContext: text('link_context'),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    connectionUnique: unique().on(
      table.sourceType,
      table.sourceId,
      table.targetType,
      table.targetSlug,
      table.connectionType,
    ),
    sourceIdx: index('connections_source_idx').on(
      table.sourceType,
      table.sourceId,
      table.connectionType,
    ),
    targetIdIdx: index('connections_target_id_idx').on(
      table.targetType,
      table.targetId,
      table.connectionType,
    ),
    targetSlugIdx: index('connections_target_slug_idx').on(
      table.targetType,
      table.targetSlug,
      table.connectionType,
    ),
  }),
);

export const connectionOccurrences = pgTable(
  'connection_occurrences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id')
      .references(() => connections.id, { onDelete: 'cascade' })
      .notNull(),
    sourceBlockId: text('source_block_id'),
    position: integer('position'),
    context: text('context'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    connectionIdx: index('connection_occurrences_connection_idx').on(table.connectionId),
  }),
);

export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    filename: text('filename').notNull().unique(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'cascade' }),
    uploadedByGuestId: uuid('uploaded_by_guest_id').references(() => guestIdentities.id),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    uploader: check(
      'uploads_uploader_check',
      sql`num_nonnulls(${table.uploadedBy}, ${table.uploadedByGuestId}) = 1`,
    ),
  }),
);

export const uploadDeletionQueue = pgTable(
  'upload_deletion_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    filename: text('filename').notNull().unique(),
    attempts: integer('attempts').default(0).notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    updatedAtIdx: index('upload_deletion_queue_updated_at_id_idx').on(table.updatedAt, table.id),
  }),
);

export const uploadPageRefs = pgTable(
  'upload_page_refs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    uploadId: uuid('upload_id')
      .references(() => uploads.id, { onDelete: 'cascade' })
      .notNull(),
    pageId: uuid('page_id')
      .references(() => pages.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    uploadPageUnique: unique('upload_page_refs_upload_page_unique').on(
      table.uploadId,
      table.pageId,
    ),
    uploadIdx: index('upload_page_refs_upload_idx').on(table.uploadId),
    pageIdx: index('upload_page_refs_page_idx').on(table.pageId),
  }),
);
