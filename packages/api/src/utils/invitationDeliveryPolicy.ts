import { sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { executeQuery, type QueryExecutor } from '../db/query';
import type { InvitationRecord } from './pendingInvitations';

const RESEND_COOLDOWN_MINUTES = 1;
const MAX_SENDER_SENDS_PER_HOUR = 20;
const MAX_SENDER_SENDS_PER_DAY = 100;
const MAX_SENDER_RECIPIENT_SENDS_PER_DAY = 5;

type DeliveryIdentity = {
  invitationId: string;
  invitedBy: string;
  email: string;
};

type DeliveryAttempt = DeliveryIdentity & {
  deliveryId: string;
  attemptNumber: number;
};

type AttemptWindow = {
  sender_hourly_count: string;
  sender_hourly_queued: string;
  sender_hourly_available_at: Date | null;
  sender_daily_count: string;
  sender_daily_queued: string;
  sender_daily_available_at: Date | null;
  recipient_count: string;
  recipient_queued: string;
  recipient_available_at: Date | null;
  latest_delivery_activity_at: Date | null;
  latest_delivery_status: 'pending' | 'processing' | 'sent' | 'failed' | 'superseded' | null;
  latest_delivery_attempts: number | string | null;
};

type DeliveryLimit = {
  count: number;
  limit: number;
  availableAt: Date | null;
  message: string;
};

async function loadAttemptWindow(
  executor: QueryExecutor,
  identity: DeliveryIdentity,
): Promise<AttemptWindow> {
  const result = await executeQuery<AttemptWindow>(
    executor,
    sql`select
          count(*) filter (
            where invited_by = ${identity.invitedBy}
              and attempted_at > now() - interval '1 hour'
          )::text as sender_hourly_count,
          min(attempted_at) filter (
            where invited_by = ${identity.invitedBy}
              and attempted_at > now() - interval '1 hour'
          ) + interval '1 hour' as sender_hourly_available_at,
          count(*) filter (
            where invited_by = ${identity.invitedBy}
              and attempted_at > now() - interval '24 hours'
          )::text as sender_daily_count,
          min(attempted_at) filter (
            where invited_by = ${identity.invitedBy}
              and attempted_at > now() - interval '24 hours'
          ) + interval '24 hours' as sender_daily_available_at,
          count(*) filter (
            where invited_by = ${identity.invitedBy} and email = ${identity.email}
              and attempted_at > now() - interval '24 hours'
          )::text as recipient_count,
          min(attempted_at) filter (
            where invited_by = ${identity.invitedBy} and email = ${identity.email}
              and attempted_at > now() - interval '24 hours'
          ) + interval '24 hours' as recipient_available_at,
          (select count(*)::text from invitation_send_attempts
           where invited_by = ${identity.invitedBy} and attempts = 0
             and status in ('pending', 'processing')
             and attempted_at > now() - interval '1 hour') as sender_hourly_queued,
          (select count(*)::text from invitation_send_attempts
           where invited_by = ${identity.invitedBy} and attempts = 0
             and status in ('pending', 'processing')
             and attempted_at > now() - interval '24 hours') as sender_daily_queued,
          (select count(*)::text from invitation_send_attempts
           where invited_by = ${identity.invitedBy} and email = ${identity.email}
             and attempts = 0 and status in ('pending', 'processing')
             and attempted_at > now() - interval '24 hours') as recipient_queued,
          greatest(
            max(attempted_at) filter (where invitation_id = ${identity.invitationId}),
            (select max(attempted_at) from invitation_send_attempts
             where invitation_id = ${identity.invitationId})
          ) as latest_delivery_activity_at,
          (select status from invitation_send_attempts
           where invitation_id = ${identity.invitationId}
           order by updated_at desc, id desc limit 1) as latest_delivery_status,
          (select attempts from invitation_send_attempts
           where invitation_id = ${identity.invitationId}
           order by updated_at desc, id desc limit 1) as latest_delivery_attempts
        from invitation_email_attempts
        where invitation_id = ${identity.invitationId} or invited_by = ${identity.invitedBy}`,
  );
  const window = result.rows[0];
  if (!window) throw new Error('Invitation delivery limit query returned no row');
  return window;
}

function deliveryLimits(window: AttemptWindow, includeQueued: boolean): DeliveryLimit[] {
  const queued = (value: string): number => (includeQueued ? Number(value) : 0);
  return [
    {
      count: Number(window.sender_hourly_count) + queued(window.sender_hourly_queued),
      limit: MAX_SENDER_SENDS_PER_HOUR,
      availableAt: window.sender_hourly_available_at,
      message: 'Hourly invitation email limit reached',
    },
    {
      count: Number(window.sender_daily_count) + queued(window.sender_daily_queued),
      limit: MAX_SENDER_SENDS_PER_DAY,
      availableAt: window.sender_daily_available_at,
      message: 'Daily invitation email limit reached',
    },
    {
      count: Number(window.recipient_count) + queued(window.recipient_queued),
      limit: MAX_SENDER_RECIPIENT_SENDS_PER_DAY,
      availableAt: window.recipient_available_at,
      message: 'Daily invitation email limit for this recipient reached',
    },
  ];
}

async function lockSender(executor: QueryExecutor, invitedBy: string): Promise<void> {
  await executeQuery(
    executor,
    sql`select pg_advisory_xact_lock(hashtextextended(${`invitation-sender:${invitedBy}`}, 0))`,
  );
}

export async function reserveInvitationEmailAttempt(
  executor: QueryExecutor,
  attempt: DeliveryAttempt,
): Promise<{ reserved: true } | { reserved: false; retryAt: Date }> {
  await lockSender(executor, attempt.invitedBy);
  const window = await loadAttemptWindow(executor, attempt);
  const blocked = deliveryLimits(window, false).filter(
    (limit): limit is DeliveryLimit & { availableAt: Date } =>
      limit.count >= limit.limit && limit.availableAt !== null,
  );
  if (blocked.length > 0) {
    return {
      reserved: false,
      retryAt: new Date(
        Math.max(...blocked.map(({ availableAt }) => new Date(availableAt).getTime())),
      ),
    };
  }

  await executeQuery(
    executor,
    sql`insert into invitation_email_attempts
          (delivery_id, invitation_id, invited_by, email, attempt_number)
        values (${attempt.deliveryId}, ${attempt.invitationId}, ${attempt.invitedBy},
                ${attempt.email}, ${attempt.attemptNumber})`,
  );
  return { reserved: true };
}

export async function enforceInvitationDeliveryLimits(
  executor: QueryExecutor,
  invitation: InvitationRecord,
): Promise<void> {
  await lockSender(executor, invitation.invited_by);
  const window = await loadAttemptWindow(executor, {
    invitationId: invitation.id,
    invitedBy: invitation.invited_by,
    email: invitation.email,
  });
  const cooldownApplies =
    window.latest_delivery_status === 'sent' ||
    (window.latest_delivery_status === 'pending' && Number(window.latest_delivery_attempts) === 0);
  if (
    cooldownApplies &&
    window.latest_delivery_activity_at &&
    Date.now() - new Date(window.latest_delivery_activity_at).getTime() <
      RESEND_COOLDOWN_MINUTES * 60_000
  ) {
    throw new HTTPException(429, {
      message: `Please wait ${RESEND_COOLDOWN_MINUTES} minute${RESEND_COOLDOWN_MINUTES === 1 ? '' : 's'} before resending`,
    });
  }
  const blocked = deliveryLimits(window, true).find((limit) => limit.count >= limit.limit);
  if (blocked) throw new HTTPException(429, { message: blocked.message });
}
