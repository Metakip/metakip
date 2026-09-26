import type { V1Principal } from '../../middleware/v1Auth';
import { materializePreparedUpload, type PreparedUpload } from '../../utils/uploadMaterialization';
import { completeIdempotency, runIdempotentMutationReservation } from './idempotency';

/**
 * Compose upload materialization with idempotency completion. Feature services
 * only prepare bytes and metadata; this boundary owns the transaction finalizer.
 */
export async function runIdempotentPreparedUpload<T extends object>(
  principal: V1Principal,
  key: string | null,
  requestHash: string,
  prepare: () => Promise<PreparedUpload<T>>,
): Promise<T> {
  return runIdempotentMutationReservation(principal, key, requestHash, async (reservation) => {
    const upload = await prepare();
    return materializePreparedUpload(upload, {
      ...(reservation
        ? {
            afterPersist: (executor, response) =>
              completeIdempotency(reservation, response, executor),
          }
        : {}),
    });
  });
}
