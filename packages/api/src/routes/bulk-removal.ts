import {
  type BulkRemovalFailure,
  type BulkRemovalOperation,
  type BulkRemovalResult,
  getApiLogger,
  MAX_BULK_REMOVAL_OPERATIONS_PER_REQUEST,
} from '@metakip/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth';
import {
  moveFolderToTrash,
  movePageToTrash,
  removeFolderFromView,
  removePageFromView,
} from '../utils/entityRemoval';

const BULK_REMOVAL_CONCURRENCY = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bulkRemovalRoute = new Hono();

bulkRemovalRoute.use('*', requireAuth);
bulkRemovalRoute.use(
  '*',
  bodyLimit({
    maxSize: 32 * 1024,
    onError: (c) => c.json({ message: 'Request body is too large' }, 413),
  }),
);

function parseOperations(value: unknown): BulkRemovalOperation[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HTTPException(400, { message: 'Request body must be an object' });
  }
  const operations = (value as Record<string, unknown>).operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new HTTPException(400, { message: 'At least one removal operation is required' });
  }
  if (operations.length > MAX_BULK_REMOVAL_OPERATIONS_PER_REQUEST) {
    throw new HTTPException(400, {
      message: `A maximum of ${MAX_BULK_REMOVAL_OPERATIONS_PER_REQUEST} items can be removed at once`,
    });
  }

  const parsed = operations.map((operation, index): BulkRemovalOperation => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new HTTPException(400, { message: `Operation ${index + 1} is invalid` });
    }
    const candidate = operation as Record<string, unknown>;
    if (candidate.entityType !== 'page' && candidate.entityType !== 'folder') {
      throw new HTTPException(400, {
        message: `Operation ${index + 1} has an invalid entity type`,
      });
    }
    if (typeof candidate.entityId !== 'string' || !UUID_PATTERN.test(candidate.entityId)) {
      throw new HTTPException(400, {
        message: `Operation ${index + 1} requires a valid entity ID`,
      });
    }
    if (candidate.action !== 'trash' && candidate.action !== 'remove-from-view') {
      throw new HTTPException(400, { message: `Operation ${index + 1} has an invalid action` });
    }
    return {
      entityType: candidate.entityType,
      entityId: candidate.entityId.toLowerCase(),
      action: candidate.action,
    };
  });

  const keys = new Set<string>();
  for (const operation of parsed) {
    const key = `${operation.entityType}:${operation.entityId}`;
    if (keys.has(key)) {
      throw new HTTPException(400, { message: 'Each entity can only be removed once per request' });
    }
    keys.add(key);
  }
  return parsed;
}

function failureCode(status: number): BulkRemovalFailure['code'] {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  return 'INTERNAL_ERROR';
}

async function executeOperation(operation: BulkRemovalOperation, userId: string): Promise<void> {
  if (operation.action === 'trash') {
    if (operation.entityType === 'page') await movePageToTrash(operation.entityId, userId);
    else await moveFolderToTrash(operation.entityId, userId, true);
    return;
  }
  if (operation.entityType === 'page') await removePageFromView(operation.entityId, userId);
  else await removeFolderFromView(operation.entityId, userId);
}

async function executeBestEffort(
  operations: readonly BulkRemovalOperation[],
  userId: string,
): Promise<BulkRemovalResult> {
  const outcomes: Array<BulkRemovalOperation | BulkRemovalFailure | undefined> = new Array(
    operations.length,
  );
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const operation = operations[index];
      if (!operation) return;
      try {
        await executeOperation(operation, userId);
        outcomes[index] = operation;
      } catch (error) {
        if (error instanceof HTTPException) {
          outcomes[index] = {
            ...operation,
            code: failureCode(error.status),
            message: error.message,
          };
        } else {
          getApiLogger().error('Bulk removal operation failed', {
            entityType: operation.entityType,
            entityId: operation.entityId,
            error: error instanceof Error ? error.message : String(error),
          });
          outcomes[index] = {
            ...operation,
            code: 'INTERNAL_ERROR',
            message: `Could not remove this ${operation.entityType}`,
          };
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BULK_REMOVAL_CONCURRENCY, operations.length) }, () => worker()),
  );

  const removedItems: BulkRemovalOperation[] = [];
  const failedItems: BulkRemovalFailure[] = [];
  for (const outcome of outcomes) {
    if (!outcome) continue;
    if ('code' in outcome) failedItems.push(outcome);
    else removedItems.push(outcome);
  }
  return {
    removedItems,
    failedItems,
    trashedCount: removedItems.filter((item) => item.action === 'trash').length,
    removedFromViewCount: removedItems.filter((item) => item.action === 'remove-from-view').length,
  };
}

bulkRemovalRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  const operations = parseOperations(body);
  const user = c.get('user') as { id: string };
  return c.json(await executeBestEffort(operations, user.id));
});

export default bulkRemovalRoute;
