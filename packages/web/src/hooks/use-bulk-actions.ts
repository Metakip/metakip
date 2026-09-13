import type {
  BulkRemovalFailure,
  BulkRemovalOperation,
  BulkRemovalRequest,
  BulkRemovalResult,
} from '@metakip/shared';
import { MAX_BULK_REMOVAL_OPERATIONS_PER_REQUEST } from '@metakip/shared';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { useIdentityLifecycle } from '../contexts/IdentityLifecycleContext';
import { beginBulkRemoval } from '../utils/bulkRemovalState';
import { isOwnedByUser } from '../utils/entity-actions';
import { showSuccessToast } from '../utils/toast';

const API_BASE = '/api';
const BULK_REMOVAL_MUTATION_KEY = ['bulk-removal'] as const;

async function movePage(pageId: string, parentId: string | null): Promise<void> {
  const res = await fetch(`${API_BASE}/pages/${pageId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId }),
  });
  if (!res.ok) throw new Error('Failed to move page');
}

async function moveFolder(folderId: string, parentId: string | null): Promise<void> {
  const res = await fetch(`${API_BASE}/folders/${folderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentId }),
  });
  if (!res.ok) throw new Error('Failed to move folder');
}

export type BulkRemovalInput = BulkRemovalRequest;

export interface BulkRemovalCandidate {
  id: string;
  type: 'page' | 'folder';
  ownerId?: string | null | undefined;
  createdBy?: string | null | undefined;
  userPermission?: 'view' | 'edit' | 'admin' | null | undefined;
  shareSource?: 'direct' | 'public' | 'workspace' | undefined;
}

export function buildBulkRemovalInput(
  items: BulkRemovalCandidate[],
  currentUserId?: string,
): BulkRemovalInput {
  const operations: BulkRemovalOperation[] = [];
  for (const item of items) {
    const isOwned = !!currentUserId && isOwnedByUser(item, currentUserId);
    const canRemoveFromView =
      !isOwned && (item.shareSource === 'direct' || item.shareSource === 'public');
    if (!isOwned && !canRemoveFromView) continue;
    operations.push({
      entityType: item.type,
      entityId: item.id,
      action: isOwned ? 'trash' : 'remove-from-view',
    });
  }
  return { operations };
}

export function getBulkRemovalCounts(input: BulkRemovalInput): {
  trashCount: number;
  removeFromViewCount: number;
} {
  return {
    trashCount: input.operations.filter((operation) => operation.action === 'trash').length,
    removeFromViewCount: input.operations.filter(
      (operation) => operation.action === 'remove-from-view',
    ).length,
  };
}

export type { BulkRemovalFailure, BulkRemovalResult } from '@metakip/shared';

const formatBulkRemovalSuccess = ({
  trashedCount,
  removedFromViewCount,
}: Pick<BulkRemovalResult, 'trashedCount' | 'removedFromViewCount'>): string => {
  const outcomes: string[] = [];
  if (trashedCount > 0) {
    outcomes.push(`Moved ${trashedCount} item${trashedCount === 1 ? '' : 's'} to Trash`);
  }
  if (removedFromViewCount > 0) {
    outcomes.push(
      `removed ${removedFromViewCount} item${removedFromViewCount === 1 ? '' : 's'} from your view`,
    );
  }
  return outcomes.join('; ');
};

export function formatBulkRemovalFailure(result: BulkRemovalResult): string {
  const total = result.removedItems.length + result.failedItems.length;
  const summary = `${result.removedItems.length} of ${total} items were removed. ${result.failedItems.length} item${result.failedItems.length === 1 ? '' : 's'} could not be removed and remain selected.`;
  const reasons = [...new Set(result.failedItems.map((failure) => failure.message))].slice(0, 3);
  return reasons.length > 0 ? `${summary} ${reasons.join(' ')}` : summary;
}

export function canRetryBulkRemoval(result: BulkRemovalResult): boolean {
  return result.failedItems.some((failure) => failure.code === 'INTERNAL_ERROR');
}

const BULK_REMOVAL_QUERY_KEYS = [
  ['folderTree'],
  ['pageTree'],
  ['trashPages'],
  ['shared-with-me'],
  ['workspace-memberships'],
  ['workspace-members'],
  ['pages', 'recent'],
  ['pages', 'detail'],
  ['folders', 'detail'],
  ['favorites'],
  ['tags'],
  ['shares'],
  ['pageCollaborators'],
  ['folderCollaborators'],
] as const;

function isOperation(value: unknown): value is BulkRemovalOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.entityType === 'page' || candidate.entityType === 'folder') &&
    typeof candidate.entityId === 'string' &&
    (candidate.action === 'trash' || candidate.action === 'remove-from-view')
  );
}

function isFailure(value: unknown): value is BulkRemovalFailure {
  if (!isOperation(value)) return false;
  const candidate = value as BulkRemovalOperation & Record<string, unknown>;
  return (
    (candidate.code === 'BAD_REQUEST' ||
      candidate.code === 'CONFLICT' ||
      candidate.code === 'FORBIDDEN' ||
      candidate.code === 'INTERNAL_ERROR' ||
      candidate.code === 'NOT_FOUND') &&
    typeof candidate.message === 'string'
  );
}

function parseBulkRemovalResult(value: unknown): BulkRemovalResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bulk removal response');
  }
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate.removedItems) ||
    !candidate.removedItems.every(isOperation) ||
    !Array.isArray(candidate.failedItems) ||
    !candidate.failedItems.every(isFailure) ||
    typeof candidate.trashedCount !== 'number' ||
    typeof candidate.removedFromViewCount !== 'number'
  ) {
    throw new Error('Invalid bulk removal response');
  }
  return {
    removedItems: candidate.removedItems,
    failedItems: candidate.failedItems,
    trashedCount: candidate.trashedCount,
    removedFromViewCount: candidate.removedFromViewCount,
  };
}

class BulkRemovalBatchError extends Error {
  constructor(
    message: string,
    readonly code: BulkRemovalFailure['code'],
  ) {
    super(message);
    this.name = 'BulkRemovalBatchError';
  }
}

function requestFailureCode(status: number): BulkRemovalFailure['code'] {
  if (status === 400 || status === 413) return 'BAD_REQUEST';
  if (status === 401 || status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  return 'INTERNAL_ERROR';
}

async function removeEntityBatch(input: BulkRemovalInput): Promise<BulkRemovalResult> {
  const response = await fetch(`${API_BASE}/bulk-removal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : 'Bulk removal failed';
    throw new BulkRemovalBatchError(message, requestFailureCode(response.status));
  }
  return parseBulkRemovalResult(body);
}

async function removeEntities(
  input: BulkRemovalInput,
  isIdentityActive: () => boolean,
): Promise<BulkRemovalResult> {
  const aggregate: BulkRemovalResult = {
    removedItems: [],
    failedItems: [],
    trashedCount: 0,
    removedFromViewCount: 0,
  };
  for (
    let offset = 0;
    offset < input.operations.length;
    offset += MAX_BULK_REMOVAL_OPERATIONS_PER_REQUEST
  ) {
    if (!isIdentityActive()) throw new Error('Identity retired during bulk removal');
    try {
      const result = await removeEntityBatch({
        operations: input.operations.slice(
          offset,
          offset + MAX_BULK_REMOVAL_OPERATIONS_PER_REQUEST,
        ),
      });
      aggregate.removedItems.push(...result.removedItems);
      aggregate.failedItems.push(...result.failedItems);
      aggregate.trashedCount += result.trashedCount;
      aggregate.removedFromViewCount += result.removedFromViewCount;
    } catch (error) {
      const code = error instanceof BulkRemovalBatchError ? error.code : 'INTERNAL_ERROR';
      const message =
        error instanceof BulkRemovalBatchError
          ? error.message
          : 'Removal could not be confirmed. Retry the remaining items.';
      aggregate.failedItems.push(
        ...input.operations.slice(offset).map((operation) => ({ ...operation, code, message })),
      );
      return aggregate;
    }
  }
  return aggregate;
}

export function useIsBulkRemovalPending(): boolean {
  return useIsMutating({ mutationKey: BULK_REMOVAL_MUTATION_KEY }) > 0;
}

export function useBulkRemoveEntities() {
  const queryClient = useQueryClient();
  const identityLifecycle = useIdentityLifecycle();
  return useMutation({
    mutationKey: BULK_REMOVAL_MUTATION_KEY,
    mutationFn: (input: BulkRemovalInput) => removeEntities(input, identityLifecycle.isActive),
    onMutate: async () => {
      const endBulkRemoval = beginBulkRemoval();
      try {
        await Promise.all(
          BULK_REMOVAL_QUERY_KEYS.map((queryKey) => queryClient.cancelQueries({ queryKey })),
        );
        return endBulkRemoval;
      } catch (error) {
        endBulkRemoval();
        throw error;
      }
    },
    onSettled: async (result, _error, _input, endBulkRemoval) => {
      try {
        await Promise.all(
          BULK_REMOVAL_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        );
        if (!identityLifecycle.isActive()) return;
        if (result && result.failedItems.length === 0) {
          showSuccessToast(formatBulkRemovalSuccess(result));
        }
      } finally {
        endBulkRemoval?.();
      }
    },
  });
}

export function useBulkMovePages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ pageIds, parentId }: { pageIds: string[]; parentId: string | null }) => {
      await Promise.all(pageIds.map((id) => movePage(id, parentId)));
    },
    onSuccess: () => {
      showSuccessToast('Pages moved');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
    },
  });
}

export function useBulkMoveFolders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      folderIds,
      parentId,
    }: {
      folderIds: string[];
      parentId: string | null;
    }) => {
      await Promise.all(folderIds.map((id) => moveFolder(id, parentId)));
    },
    onSuccess: () => {
      showSuccessToast('Folders moved');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['folderTree'] });
      queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
    },
  });
}
