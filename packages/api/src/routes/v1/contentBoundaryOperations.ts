import { createHash } from 'node:crypto';
import { normalizeLineEndings } from '@metakip/shared';
import { Hono } from 'hono';
import { requireV1OperationScope } from '../../middleware/v1Auth';
import { applyPageContentBoundaryOperation } from '../../utils/collaborationContentClient';
import { parseIdempotencyKey, runIdempotentContentCommand } from './idempotency';
import { contentBoundaryOperationSchema, pageOperations } from './pageContracts';
import { requireUuid } from './pageModel';
import { v1DocumentJsonBodyLimit } from './requestLimits';
import { parseJsonRequest } from './requestValidation';

const contentBoundaryOperationsRoute = new Hono();

contentBoundaryOperationsRoute.post(
  pageOperations.boundaryContentOperation.routePath,
  requireV1OperationScope(pageOperations.boundaryContentOperation),
  v1DocumentJsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const idempotencyKey = parseIdempotencyKey(c.req.header('idempotency-key'));
    const request = await parseJsonRequest(c, contentBoundaryOperationSchema);
    const operation = { ...request, content: normalizeLineEndings(request.content) };
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ pageId, ...operation }))
      .digest('base64url');
    const response = await runIdempotentContentCommand(
      principal,
      idempotencyKey,
      requestHash,
      (reservation) =>
        applyPageContentBoundaryOperation(pageId, principal, {
          ...operation,
          ...(reservation ? { idempotency: reservation } : {}),
        }),
    );
    c.header('ETag', response.etag);
    return c.json(response);
  },
);

export default contentBoundaryOperationsRoute;
