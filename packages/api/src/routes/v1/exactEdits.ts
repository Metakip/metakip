import { createHash } from 'node:crypto';
import { normalizeLineEndings } from '@metakip/shared';
import { Hono } from 'hono';
import { requireV1OperationScope } from '../../middleware/v1Auth';
import { applyPageExactEdits } from '../../utils/collaborationContentClient';
import { parseIdempotencyKey, runIdempotentContentCommand } from './idempotency';
import { type ExactEditsResponse, exactEditsRequestSchema, pageOperations } from './pageContracts';
import { requireUuid } from './pageModel';
import { v1DocumentJsonBodyLimit } from './requestLimits';
import { parseJsonRequest } from './requestValidation';

type EditResponse = ExactEditsResponse;

const exactEditsRoute = new Hono();

exactEditsRoute.post(
  pageOperations.editContent.routePath,
  requireV1OperationScope(pageOperations.editContent),
  v1DocumentJsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const idempotencyKey = parseIdempotencyKey(c.req.header('idempotency-key'));
    const request = await parseJsonRequest(c, exactEditsRequestSchema);
    const edits = request.edits.map((edit) => ({
      id: edit.id,
      oldText: normalizeLineEndings(edit.oldText),
      newText: normalizeLineEndings(edit.newText),
    }));
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ pageId, edits }))
      .digest('base64url');
    const response = await runIdempotentContentCommand<EditResponse>(
      principal,
      idempotencyKey,
      requestHash,
      (reservation) =>
        applyPageExactEdits(pageId, principal, {
          edits,
          ...(reservation ? { idempotency: reservation } : {}),
        }),
    );
    c.header('ETag', response.etag);
    return c.json(response);
  },
);

export default exactEditsRoute;
