import type {
  InvitationLifecycleStatus,
  InvitationTargetType,
  ShareEntityType,
  SharePermission,
  WorkspaceRole,
} from '@metakip/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './userSchema';

export const pendingInvitations = pgTable(
  'pending_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    targetType: text('target_type').notNull().$type<InvitationTargetType>(),
    targetId: uuid('target_id').notNull(),
    email: text('email').notNull(),
    permission: text('permission').notNull().$type<WorkspaceRole | SharePermission>(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending').$type<InvitationLifecycleStatus>(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    targetEmailUnique: unique('pending_invitations_target_email_unique').on(
      table.targetType,
      table.targetId,
      table.email,
    ),
    tokenHashUnique: unique('pending_invitations_token_hash_unique').on(table.tokenHash),
    targetIdx: index('pending_invitations_target_idx').on(table.targetType, table.targetId),
    invitedByIdx: index('pending_invitations_invited_by_idx').on(table.invitedBy),
    acceptedByIdx: index('pending_invitations_accepted_by_idx').on(table.acceptedBy),
    retentionIdx: index('pending_invitations_retention_idx').on(table.status, table.resolvedAt),
    expiryIdx: index('pending_invitations_expiry_idx').on(table.expiresAt),
    targetPermissionCheck: check(
      'pending_invitations_target_permission_check',
      sql`(${table.targetType} = 'workspace' and ${table.permission} in ('viewer', 'editor', 'admin'))
            or (${table.targetType} in ('page', 'folder') and ${table.permission} in ('view', 'commenter', 'edit', 'admin'))`,
    ),
    statusCheck: check(
      'pending_invitations_status_check',
      sql`${table.status} in ('pending', 'accepted', 'declined', 'revoked', 'superseded')`,
    ),
    resolutionCheck: check(
      'pending_invitations_resolution_check',
      sql`(${table.status} = 'pending' and ${table.resolvedAt} is null and ${table.acceptedBy} is null)
            or (${table.status} = 'accepted' and ${table.resolvedAt} is not null and ${table.acceptedBy} is not null)
            or (${table.status} in ('declined', 'revoked', 'superseded')
                and ${table.resolvedAt} is not null and ${table.acceptedBy} is null)`,
    ),
  }),
);

type PendingInvitationSelect = typeof pendingInvitations.$inferSelect;

type InvitationDatabaseRecordBase = {
  id: PendingInvitationSelect['id'];
  target_id: PendingInvitationSelect['targetId'];
  email: PendingInvitationSelect['email'];
  invited_by: PendingInvitationSelect['invitedBy'];
  token_hash: PendingInvitationSelect['tokenHash'];
  expires_at: PendingInvitationSelect['expiresAt'];
  status: PendingInvitationSelect['status'];
  resolved_at: PendingInvitationSelect['resolvedAt'];
  accepted_by: PendingInvitationSelect['acceptedBy'];
  created_at: PendingInvitationSelect['createdAt'];
};

export type InvitationDatabaseRecord = InvitationDatabaseRecordBase &
  (
    | { target_type: 'workspace'; permission: WorkspaceRole }
    | { target_type: ShareEntityType; permission: SharePermission }
  );

export const invitationSendAttempts = pgTable(
  'invitation_send_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invitationId: uuid('invitation_id')
      .notNull()
      .references(() => pendingInvitations.id, { onDelete: 'cascade' }),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenEncrypted: text('token_encrypted').notNull(),
    tokenHash: text('token_hash').notNull(),
    // Frozen before the first provider call; encrypted because the body
    // contains the bearer invitation URL. Retries reuse these exact bytes.
    emailBodyEncrypted: text('email_body_encrypted'),
    status: text('status')
      .notNull()
      .$type<'pending' | 'processing' | 'sent' | 'failed' | 'superseded'>(),
    attempts: integer('attempts').default(0).notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    claimToken: uuid('claim_token'),
    lastError: text('last_error'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    invitationAttemptedIdx: index('invitation_send_attempts_invitation_attempted_idx').on(
      table.invitationId,
      table.attemptedAt,
    ),
    senderAttemptedIdx: index('invitation_send_attempts_sender_attempted_idx').on(
      table.invitedBy,
      table.attemptedAt,
    ),
    senderEmailAttemptedIdx: index('invitation_send_attempts_sender_email_attempted_idx').on(
      table.invitedBy,
      table.email,
      table.attemptedAt,
    ),
    pendingDeliveryIdx: index('invitation_send_attempts_pending_delivery_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
    completedIdx: index('invitation_send_attempts_completed_idx').on(table.completedAt),
    activeInvitationUnique: uniqueIndex('invitation_send_attempts_active_invitation_unique')
      .on(table.invitationId)
      .where(sql`${table.status} in ('pending', 'processing')`),
    statusCheck: check(
      'invitation_send_attempts_status_check',
      sql`${table.status} in ('pending', 'processing', 'sent', 'failed', 'superseded')`,
    ),
    attemptsCheck: check(
      'invitation_send_attempts_attempts_check',
      sql`${table.attempts} between 0 and 5`,
    ),
    stateCheck: check(
      'invitation_send_attempts_state_check',
      sql`(${table.status} = 'pending'
              and ${table.completedAt} is null
              and ${table.leaseUntil} is null
              and ${table.claimToken} is null
              and ${table.nextAttemptAt} is not null)
            or (${table.status} = 'processing'
              and ${table.attempts} > 0
              and ${table.completedAt} is null
              and ${table.leaseUntil} is not null
              and ${table.claimToken} is not null
              and ${table.nextAttemptAt} is not null)
            or (${table.status} in ('sent', 'failed', 'superseded')
              and ${table.completedAt} is not null
              and ${table.leaseUntil} is null
              and ${table.claimToken} is null
              and ${table.nextAttemptAt} is null)`,
    ),
  }),
);

export const invitationEmailAttempts = pgTable(
  'invitation_email_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    deliveryId: uuid('delivery_id').notNull(),
    invitationId: uuid('invitation_id').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    deliveryAttemptUnique: unique('invitation_email_attempts_delivery_attempt_unique').on(
      table.deliveryId,
      table.attemptNumber,
    ),
    invitationAttemptedIdx: index('invitation_email_attempts_invitation_attempted_idx').on(
      table.invitationId,
      table.attemptedAt,
    ),
    senderAttemptedIdx: index('invitation_email_attempts_sender_attempted_idx').on(
      table.invitedBy,
      table.attemptedAt,
    ),
    senderEmailAttemptedIdx: index('invitation_email_attempts_sender_email_attempted_idx').on(
      table.invitedBy,
      table.email,
      table.attemptedAt,
    ),
    retentionIdx: index('invitation_email_attempts_retention_idx').on(table.attemptedAt),
  }),
);
