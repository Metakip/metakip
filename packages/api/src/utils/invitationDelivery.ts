import { createHash, randomUUID } from 'node:crypto';
import { getApiLogger } from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/connection';
import { executeQuery, type QueryExecutor } from '../db/query';
import { decryptInvitationSecret, encryptInvitationSecret } from './invitationCipher';
import {
  enforceInvitationDeliveryLimits,
  reserveInvitationEmailAttempt,
} from './invitationDeliveryPolicy';
import {
  InvitationEmailError,
  isInvitationEmailDeliveryAvailable,
  isRetryableInvitationEmailError,
  renderInvitationEmail,
  sendInvitationEmail,
} from './invitationEmail';
import { resolveInvitationPresentation } from './invitationPresentation';
import {
  findInvitationById,
  type InvitationPreparationParams,
  type InvitationRecord,
  lockInvitationRecordIfPresent,
  type PreparedInvitation,
  preparePendingInvitation,
  resolveInvitationCommandStatus,
} from './pendingInvitations';

const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_BATCH_SIZE = 25;
const DELIVERY_CONCURRENCY = 4;
export const INVITATION_DELIVERY_INTERVAL_MS = 60_000;

export type QueuedInvitationDelivery = PreparedInvitation & {
  deliveryId: string;
};

export type InvitationDeliveryDrainResult = {
  failed: number;
  processed: number;
};

type DeliveryJob = {
  id: string;
  invitation_id: string;
  invited_by: string;
  email: string;
  token_encrypted: string;
  token_hash: string;
  attempts: number;
  claim_token: string;
};

type DeliveryClaim = { kind: 'job'; job: DeliveryJob } | { kind: 'deferred' };

async function releaseExpiredFinalAttemptForResend(
  executor: QueryExecutor,
  invitationId: string,
): Promise<void> {
  await executeQuery(
    executor,
    sql`update invitation_send_attempts
        set status = 'failed', completed_at = now(), next_attempt_at = null,
            lease_until = null, claim_token = null,
            last_error = coalesce(last_error, 'Delivery worker stopped during final attempt'),
            updated_at = now()
        where invitation_id = ${invitationId}
          and status = 'processing'
          and attempts >= ${MAX_DELIVERY_ATTEMPTS}
          and lease_until <= now()`,
  );
}

export async function prepareAndEnqueueInvitation(
  executor: QueryExecutor,
  params: InvitationPreparationParams,
): Promise<QueuedInvitationDelivery> {
  const prepared = await preparePendingInvitation(executor, params);
  return prepared.token === null
    ? enqueueInvitationResend(executor, prepared.invitation)
    : enqueueDeliveryRecord(executor, prepared);
}

async function enqueueDeliveryRecord(
  executor: QueryExecutor,
  prepared: PreparedInvitation,
): Promise<QueuedInvitationDelivery> {
  await releaseExpiredFinalAttemptForResend(executor, prepared.invitation.id);
  const active = await executeQuery<{ status: 'pending' | 'processing' }>(
    executor,
    sql`select status from invitation_send_attempts
        where invitation_id = ${prepared.invitation.id}
          and status in ('pending', 'processing')
        for update`,
  );
  if (active.rows.some((delivery) => delivery.status === 'processing')) {
    throw new HTTPException(409, { message: 'Invitation email delivery is already in progress' });
  }
  // Delivery workers lock a delivery row before reserving a sender slot. Keep
  // enqueue/resend on the same delivery -> sender order to prevent deadlocks.
  await enforceInvitationDeliveryLimits(executor, prepared.invitation);
  await executeQuery(
    executor,
    sql`update invitation_send_attempts
        set status = 'superseded', completed_at = now(), next_attempt_at = null,
            lease_until = null, claim_token = null, updated_at = now()
        where invitation_id = ${prepared.invitation.id}
          and status = 'pending'`,
  );
  const queued = await executeQuery<{ id: string }>(
    executor,
    sql`insert into invitation_send_attempts
          (invitation_id, invited_by, email, token_encrypted, token_hash, status)
        values (${prepared.invitation.id}, ${prepared.invitation.invited_by},
                ${prepared.invitation.email}, ${encryptInvitationSecret(prepared.token)},
                ${prepared.invitation.token_hash}, 'pending')
        returning id`,
  );
  const deliveryId = queued.rows[0]?.id;
  if (!deliveryId) throw new Error('Invitation delivery enqueue did not return an ID');
  return { ...prepared, deliveryId };
}

export async function enqueueInvitationResend(
  executor: QueryExecutor,
  invitation: InvitationRecord,
): Promise<QueuedInvitationDelivery> {
  const tokenResult = await executeQuery<{ token_encrypted: string }>(
    executor,
    sql`select token_encrypted from invitation_send_attempts
        where invitation_id = ${invitation.id} and token_hash = ${invitation.token_hash}
        order by attempted_at desc, id desc
        limit 1`,
  );
  const encryptedToken = tokenResult.rows[0]?.token_encrypted;
  if (!encryptedToken) {
    throw new HTTPException(409, { message: 'Invitation delivery token is unavailable' });
  }
  const token = decryptInvitationSecret(encryptedToken);
  if (createHash('sha256').update(token).digest('hex') !== invitation.token_hash) {
    throw new Error('Invitation delivery token does not match its invitation');
  }
  const result = await executeQuery<InvitationRecord>(
    executor,
    sql`update pending_invitations
        set expires_at = now() + interval '7 days', updated_at = now()
        where id = ${invitation.id}
        returning *`,
  );
  const updated = result.rows[0];
  if (!updated) throw new Error('Invitation resend did not return a row');
  return enqueueDeliveryRecord(executor, { invitation: updated, token });
}

async function claimDeliveryJob(deliveryId?: string): Promise<DeliveryClaim | null> {
  return db.transaction(async (tx) => {
    const result = await executeQuery<DeliveryJob>(
      tx,
      sql`select delivery.id, delivery.invitation_id, delivery.invited_by, delivery.email,
                 delivery.token_encrypted, delivery.token_hash, delivery.attempts,
                 delivery.claim_token
          from invitation_send_attempts delivery
          where (${deliveryId ?? null}::uuid is null or delivery.id = ${deliveryId ?? null})
            and (
              delivery.attempts < ${MAX_DELIVERY_ATTEMPTS}
              or (
                delivery.attempts = ${MAX_DELIVERY_ATTEMPTS}
                and delivery.status = 'processing'
                and delivery.lease_until <= now()
              )
            )
            and delivery.next_attempt_at <= now()
            and (
              delivery.status = 'pending'
              or (delivery.status = 'processing' and delivery.lease_until <= now())
            )
          order by delivery.next_attempt_at, delivery.id
          limit 1
          for update of delivery skip locked`,
    );
    const job = result.rows[0];
    if (!job) return null;
    if (job.attempts === MAX_DELIVERY_ATTEMPTS) {
      // The final provider call may have completed before the worker stopped.
      // Retry the same job and idempotency key without consuming a sixth
      // attempt or rate-limit reservation.
      const claimToken = randomUUID();
      await executeQuery(
        tx,
        sql`update invitation_send_attempts
            set claim_token = ${claimToken},
                lease_until = now() + interval '30 seconds', updated_at = now()
            where id = ${job.id} and status = 'processing'
              and attempts = ${MAX_DELIVERY_ATTEMPTS}`,
      );
      return { kind: 'job', job: { ...job, claim_token: claimToken } };
    }
    const attemptNumber = job.attempts + 1;
    const reservation = await reserveInvitationEmailAttempt(tx, {
      deliveryId: job.id,
      invitationId: job.invitation_id,
      invitedBy: job.invited_by,
      email: job.email,
      attemptNumber,
    });
    if (!reservation.reserved) {
      await executeQuery(
        tx,
        sql`update invitation_send_attempts
            set status = 'pending', next_attempt_at = ${reservation.retryAt},
                lease_until = null, claim_token = null,
                updated_at = now()
            where id = ${job.id}`,
      );
      return { kind: 'deferred' };
    }
    const claimToken = randomUUID();
    await executeQuery(
      tx,
      sql`update invitation_send_attempts
          set status = 'processing', attempts = attempts + 1,
              claim_token = ${claimToken}, lease_until = now() + interval '30 seconds',
              updated_at = now()
          where id = ${job.id}`,
    );
    return {
      kind: 'job',
      job: { ...job, attempts: attemptNumber, claim_token: claimToken },
    };
  });
}

async function markDeliveryTerminal(
  executor: QueryExecutor,
  job: DeliveryJob,
  status: 'sent' | 'failed',
  lastError: string | null = null,
): Promise<boolean> {
  const finalized = await executeQuery(
    executor,
    sql`update invitation_send_attempts
          set status = ${status}, completed_at = now(), next_attempt_at = null,
              lease_until = null, claim_token = null,
              last_error = ${lastError}, updated_at = now()
          where id = ${job.id} and status = 'processing' and attempts = ${job.attempts}
            and claim_token = ${job.claim_token}`,
  );
  return Boolean(finalized.rowCount);
}

async function markDeliveryFailure(
  executor: QueryExecutor,
  job: DeliveryJob,
  error: unknown,
  retryable: boolean,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const delays = [60, 300, 900, 3_600, 21_600] as const;
  const delay = delays[Math.min(job.attempts - 1, delays.length - 1)] ?? 21_600;
  const terminal = !retryable || job.attempts >= MAX_DELIVERY_ATTEMPTS;
  const deliveryStatus = terminal ? 'failed' : 'pending';
  const finalized = await executeQuery(
    executor,
    sql`update invitation_send_attempts
          set status = ${deliveryStatus}, last_error = ${message}, lease_until = null,
              claim_token = null,
              next_attempt_at = ${terminal ? null : sql`now() + make_interval(secs => ${delay})`},
              completed_at = ${terminal ? sql`now()` : null}, updated_at = now()
          where id = ${job.id} and status = 'processing' and attempts = ${job.attempts}
            and claim_token = ${job.claim_token}`,
  );
  if (!finalized.rowCount) return;
  getApiLogger().error(
    terminal
      ? 'Invitation delivery failed permanently'
      : 'Invitation delivery failed and remains queued for retry',
    {
      attempts: job.attempts,
      deliveryId: job.id,
      error: message,
    },
  );
}

function decryptDeliverySecret(value: string): string {
  try {
    return decryptInvitationSecret(value);
  } catch (cause) {
    throw new InvitationEmailError('Invitation delivery data could not be decrypted', false, {
      cause,
    });
  }
}

async function prepareDeliveryEmail(job: DeliveryJob): Promise<string | null> {
  return db.transaction(async (tx) => {
    const initial = await findInvitationById(job.invitation_id, tx);
    if (!initial) return null;
    const invitation = await lockInvitationRecordIfPresent(tx, initial);
    if (!invitation) return null;
    const current = await executeQuery<{ email_body_encrypted: string | null }>(
      tx,
      sql`select email_body_encrypted from invitation_send_attempts
          where id = ${job.id} and status = 'processing' and attempts = ${job.attempts}
            and claim_token = ${job.claim_token}
          for update`,
    );
    const delivery = current.rows[0];
    if (!delivery) return null;
    if (
      invitation.token_hash !== job.token_hash ||
      (await resolveInvitationCommandStatus(tx, invitation)) !== 'pending'
    ) {
      await markDeliveryTerminal(tx, job, 'failed');
      return null;
    }
    if (delivery.email_body_encrypted !== null) {
      return decryptDeliverySecret(delivery.email_body_encrypted);
    }

    const presentation = await resolveInvitationPresentation(invitation, tx);
    const body = renderInvitationEmail(
      invitation,
      presentation,
      decryptDeliverySecret(job.token_encrypted),
    );
    // Freeze the exact request before contacting the provider. Keeping it in
    // the job also covers crashes after sending but before finalization.
    await executeQuery(
      tx,
      sql`update invitation_send_attempts
          set email_body_encrypted = ${encryptInvitationSecret(body)}, updated_at = now()
          where id = ${job.id} and status = 'processing' and attempts = ${job.attempts}
            and claim_token = ${job.claim_token}`,
    );
    return body;
  });
}

async function processDeliveryJob(job: DeliveryJob): Promise<boolean> {
  try {
    const body = await prepareDeliveryEmail(job);
    if (body === null) return false;
    // Never hold a database transaction or connection while waiting for the
    // external email provider. The processing lease remains the sole durable
    // ownership marker until the short finalization transaction below.
    await sendInvitationEmail(job.id, body);
  } catch (error) {
    const retryable =
      error instanceof HTTPException
        ? error.status === 408 ||
          error.status === 425 ||
          error.status === 429 ||
          error.status >= 500
        : isRetryableInvitationEmailError(error);
    await db.transaction((tx) => markDeliveryFailure(tx, job, error, retryable));
    return false;
  }

  return db.transaction((tx) => markDeliveryTerminal(tx, job, 'sent'));
}

export async function processInvitationDeliveryQueue(
  options: { batchSize?: number; deliveryId?: string } = {},
): Promise<InvitationDeliveryDrainResult> {
  // Configuration outages must not consume retries or turn queued mail into
  // permanent failures. Production validates this at startup; this guard also
  // keeps development queues intact until delivery is configured.
  if (!isInvitationEmailDeliveryAvailable()) return { failed: 0, processed: 0 };
  const batchSize = options.deliveryId ? 1 : (options.batchSize ?? DELIVERY_BATCH_SIZE);
  let examined = 0;
  let failed = 0;
  let processed = 0;
  while (examined < batchSize) {
    const remaining = batchSize - examined;
    const claims = await Promise.all(
      Array.from({ length: Math.min(DELIVERY_CONCURRENCY, remaining) }, () =>
        claimDeliveryJob(options.deliveryId),
      ),
    );
    const examinedClaims = claims.filter((claim): claim is DeliveryClaim => claim !== null);
    if (examinedClaims.length === 0) break;
    examined += examinedClaims.length;
    const jobs = examinedClaims
      .filter((claim): claim is Extract<DeliveryClaim, { kind: 'job' }> => claim.kind === 'job')
      .map((claim) => claim.job);
    // A database failure during finalization must not abandon other jobs in
    // the batch. Their leases remain recoverable if finalization cannot commit.
    const outcomes = await Promise.allSettled(jobs.map(processDeliveryJob));
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.status === 'fulfilled' && outcome.value) {
        processed += 1;
      } else {
        failed += 1;
        if (outcome.status === 'rejected') {
          getApiLogger().error('Invitation delivery job could not be finalized', {
            deliveryId: jobs[index]?.id,
            error:
              outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
          });
        }
      }
    }
  }
  return { failed, processed };
}

let deliveryDrainTask: Promise<InvitationDeliveryDrainResult> | null = null;

export function runInvitationDeliveryWorker(): Promise<InvitationDeliveryDrainResult> {
  if (deliveryDrainTask) return deliveryDrainTask;
  deliveryDrainTask = processInvitationDeliveryQueue().finally(() => {
    deliveryDrainTask = null;
  });
  return deliveryDrainTask;
}
