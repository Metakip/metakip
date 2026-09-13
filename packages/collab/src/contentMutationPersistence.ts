import {
  API_IDEMPOTENCY_REPLAY_SECONDS,
  type ApiTokenAuditResult,
  type ContentAuditOperation,
  type ContentBoundaryOperationResponse,
  type ContentIdempotencyReservation,
  type ExactEditCommandResponse,
  type PageContentMetadata,
} from '@metakip/shared';
import type { PoolClient } from 'pg';
import { contentMetadataHash } from './contentRevision';

export type ContentCommandEffects = {
  metadata?: PageContentMetadata;
  tokenAudit?: {
    tokenId: string;
    ownerId: string;
    operation: ContentAuditOperation;
    result: ApiTokenAuditResult;
  };
  idempotency?: ContentIdempotencyReservation & {
    principalKey: string;
    response: ExactEditCommandResponse | ContentBoundaryOperationResponse;
  };
};

type ContentIdempotencyCompletion = NonNullable<ContentCommandEffects['idempotency']>;

export type DocumentPersistenceMutation = ContentCommandEffects & {
  expectedMetadataHash: string;
  prepareCommittedState?: (state: Uint8Array) => void;
};

export function matchesContentMetadataRevision(
  current: PageContentMetadata,
  mutation: DocumentPersistenceMutation,
): boolean {
  return contentMetadataHash(current) === mutation.expectedMetadataHash;
}

export async function persistContentCommandEffects(
  client: PoolClient,
  pageId: string,
  mutation: ContentCommandEffects,
): Promise<void> {
  if (mutation.metadata) {
    await client.query(
      `update pages set properties = $1, icon = $2, updated_at = now() where id = $3`,
      [
        mutation.metadata.properties === null ? null : JSON.stringify(mutation.metadata.properties),
        mutation.metadata.icon,
        pageId,
      ],
    );
  }
  if (mutation.tokenAudit) {
    await client.query(
      `insert into api_token_audit_events
       (token_id, owner_id, page_id, operation, result)
       values ($1, $2, $3, $4, $5)`,
      [
        mutation.tokenAudit.tokenId,
        mutation.tokenAudit.ownerId,
        pageId,
        mutation.tokenAudit.operation,
        mutation.tokenAudit.result,
      ],
    );
  }
  if (mutation.idempotency) {
    await completeContentIdempotency(client, mutation.idempotency);
  }
}

export async function completeContentIdempotency(
  client: PoolClient,
  completion: ContentIdempotencyCompletion,
): Promise<void> {
  const completed = await client.query(
    `update api_idempotency_records
     set response = $1, etag = $2,
         expires_at = now() + ($7 * interval '1 second')
     where id = $3 and principal_key = $4 and idempotency_key = $5
       and request_hash = $6 and response is null`,
    [
      JSON.stringify(completion.response),
      completion.response.etag,
      completion.recordId,
      completion.principalKey,
      completion.key,
      completion.requestHash,
      API_IDEMPOTENCY_REPLAY_SECONDS,
    ],
  );
  if (completed.rowCount !== 1) {
    throw new Error('Idempotency reservation is no longer available');
  }
}
