import './env';
import { serve } from '@hono/node-server';
import { getApiLogger } from '@metakip/shared';
import { createApp } from './app';
import { auth } from './auth';
import {
  invitationTokenEncryptionKeys,
  requireCollaborationInternalSecret,
  requireInvitationEmailConfiguration,
  requireMcpApiInternalSecret,
} from './env';
import {
  drainOperationalRetention,
  OPERATIONAL_RETENTION_INTERVAL_MS,
} from './utils/dataRetention';
import { drainExpiredGuestIdentities } from './utils/guestIdentityCleanup';
import {
  INVITATION_DELIVERY_INTERVAL_MS,
  runInvitationDeliveryWorker,
} from './utils/invitationDelivery';
import { processUploadDeletionQueue } from './utils/uploadCleanup';
import { getUploadStorage } from './utils/uploadStorage';

async function main() {
  // Better Auth seeds and verifies the configured MCP resource while its
  // context initializes. Fail startup before binding the listening socket if
  // that canonical auth instance cannot initialize.
  await auth.$context;
  const app = await createApp();

  let retentionTask: Promise<void> | null = null;
  const runRetention = () => {
    if (retentionTask) return;
    retentionTask = drainOperationalRetention()
      .then(
        ({
          idempotencyRecords,
          tokenAuditEvents,
          oauthClientAssertions,
          oauthAccessTokenRevocations,
          invitationEmailAttempts,
          invitationSendAttempts,
          pendingInvitations,
        }) => {
          if (
            idempotencyRecords > 0 ||
            tokenAuditEvents > 0 ||
            oauthClientAssertions > 0 ||
            oauthAccessTokenRevocations > 0 ||
            invitationEmailAttempts > 0 ||
            invitationSendAttempts > 0 ||
            pendingInvitations > 0
          ) {
            getApiLogger().info('Operational retention cleanup completed', {
              idempotencyRecords,
              tokenAuditEvents,
              oauthClientAssertions,
              oauthAccessTokenRevocations,
              invitationEmailAttempts,
              invitationSendAttempts,
              pendingInvitations,
            });
          }
        },
      )
      .catch((error: unknown) => {
        // Scheduled maintenance is an explicit background boundary. Report
        // the failed run and allow the next interval to retry from the DB.
        getApiLogger().error('Operational retention cleanup failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        retentionTask = null;
      });
  };
  let guestCleanupTask: Promise<void> | null = null;
  const runGuestCleanup = () => {
    if (guestCleanupTask) return;
    guestCleanupTask = drainExpiredGuestIdentities()
      .then((deleted) => {
        if (deleted > 0)
          getApiLogger().info('Expired guest identity cleanup completed', { deleted });
      })
      .catch((error: unknown) => {
        getApiLogger().error('Guest identity cleanup failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        guestCleanupTask = null;
      });
  };
  let uploadCleanupTask: Promise<void> | null = null;
  const runUploadCleanup = () => {
    if (uploadCleanupTask) return;
    uploadCleanupTask = processUploadDeletionQueue()
      .then(() => undefined)
      .catch((error: unknown) => {
        getApiLogger().error('Upload deletion queue drain failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        uploadCleanupTask = null;
      });
  };
  const uploadCleanupTimer = setInterval(runUploadCleanup, 60_000);
  uploadCleanupTimer.unref();

  const invitationDeliveryTimer = setInterval(() => {
    void runInvitationDeliveryWorker().catch((error: unknown) => {
      // Scheduled queue draining is an explicit background boundary. Durable
      // rows and leases make the next interval safe to retry.
      getApiLogger().error('Invitation delivery queue drain failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, INVITATION_DELIVERY_INTERVAL_MS);
  invitationDeliveryTimer.unref();

  const guestCleanupTimer = setInterval(runGuestCleanup, 24 * 60 * 60 * 1000);
  guestCleanupTimer.unref();
  // Each bounded run can remove 100,000 expired rows per table. Running once
  // per minute keeps cleanup capacity well above expected API ingestion while
  // retaining a hard per-run query bound.
  const retentionTimer = setInterval(runRetention, OPERATIONAL_RETENTION_INTERVAL_MS);
  retentionTimer.unref();

  const port = Number(process.env.PORT ?? 3001);

  serve({
    fetch: app.fetch,
    port,
  });

  const initialInvitationDelivery = setTimeout(() => {
    void runInvitationDeliveryWorker().catch((error: unknown) => {
      // Startup delivery is a background boundary. Durable rows remain
      // available for the interval worker after an unexpected failure.
      getApiLogger().error('Initial invitation delivery queue drain failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 0);
  initialInvitationDelivery.unref();

  const initialGuestCleanup = setTimeout(runGuestCleanup, 0);
  initialGuestCleanup.unref();
  const initialRetention = setTimeout(runRetention, 0);
  initialRetention.unref();
  const initialUploadCleanup = setTimeout(runUploadCleanup, 0);
  initialUploadCleanup.unref();
}

// Validate the private API-to-collaboration trust boundary before the API
// opens its listening socket or reports healthy.
requireCollaborationInternalSecret();
invitationTokenEncryptionKeys();
if (process.env.NODE_ENV === 'production') requireInvitationEmailConfiguration();
requireMcpApiInternalSecret();
getUploadStorage();
main();

export type { AppType } from './app';

export { createApp } from './app';
