import { type CollaboratorDisplay, MAX_COLLABORATOR_ENTITY_IDS_PER_REQUEST } from '@metakip/shared';
import { useQuery } from '@tanstack/react-query';
import { isBulkRemovalInProgress } from '../utils/bulkRemovalState';

const API_BASE = '/api';
const COLLABORATOR_DISPLAY_QUERY_VERSION = 2;
const COLLABORATOR_REQUEST_CONCURRENCY = 3;

type CollaboratorsResponse = Record<string, CollaboratorDisplay[]>;

function isCollaboratorDisplay(value: unknown): value is CollaboratorDisplay {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === 'string' &&
    (typeof candidate.name === 'string' || candidate.name === null) &&
    (typeof candidate.avatarUrl === 'string' || candidate.avatarUrl === null) &&
    (candidate.permission === 'view' ||
      candidate.permission === 'edit' ||
      candidate.permission === 'admin') &&
    typeof candidate.isOwner === 'boolean'
  );
}

function parseCollaboratorsResponse(value: unknown): CollaboratorsResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid collaborator response');
  }
  const response: CollaboratorsResponse = {};
  for (const [entityId, collaborators] of Object.entries(value)) {
    if (!Array.isArray(collaborators) || !collaborators.every(isCollaboratorDisplay)) {
      throw new Error('Invalid collaborator response');
    }
    response[entityId] = collaborators;
  }
  return response;
}

async function fetchCollaboratorBatch(
  entityType: 'page' | 'folder',
  entityIds: string[],
): Promise<CollaboratorsResponse> {
  const params = new URLSearchParams({ ids: entityIds.join(',') });
  const routeSegment = entityType === 'page' ? 'pages' : 'folders';
  const res = await fetch(`${API_BASE}/shares/${routeSegment}/collaborators?${params}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${entityType} collaborators`);
  }
  return parseCollaboratorsResponse(await res.json());
}

async function fetchCollaborators(
  entityType: 'page' | 'folder',
  entityIds: string[],
): Promise<CollaboratorsResponse> {
  if (entityIds.length === 0) return {};
  const batches: string[][] = [];
  for (
    let offset = 0;
    offset < entityIds.length;
    offset += MAX_COLLABORATOR_ENTITY_IDS_PER_REQUEST
  ) {
    batches.push(entityIds.slice(offset, offset + MAX_COLLABORATOR_ENTITY_IDS_PER_REQUEST));
  }
  const responses: Array<CollaboratorsResponse | undefined> = new Array(batches.length);
  let nextBatchIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      const batch = batches[batchIndex];
      if (!batch) return;
      responses[batchIndex] = await fetchCollaboratorBatch(entityType, batch);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(COLLABORATOR_REQUEST_CONCURRENCY, batches.length) }, () =>
      worker(),
    ),
  );
  const merged: CollaboratorsResponse = {};
  for (const response of responses) {
    if (response) Object.assign(merged, response);
  }
  return merged;
}

export function usePageCollaborators(pageIds: string[]) {
  const sortedIds = [...new Set(pageIds)].sort();
  return useQuery({
    queryKey: ['pageCollaborators', COLLABORATOR_DISPLAY_QUERY_VERSION, sortedIds],
    queryFn: () => fetchCollaborators('page', sortedIds),
    staleTime: 1000 * 60,
    enabled: sortedIds.length > 0,
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}

export function useFolderCollaborators(folderIds: string[]) {
  const sortedIds = [...new Set(folderIds)].sort();
  return useQuery({
    queryKey: ['folderCollaborators', COLLABORATOR_DISPLAY_QUERY_VERSION, sortedIds],
    queryFn: () => fetchCollaborators('folder', sortedIds),
    staleTime: 1000 * 60,
    enabled: sortedIds.length > 0,
    refetchOnWindowFocus: () => !isBulkRemovalInProgress(),
    refetchOnReconnect: () => !isBulkRemovalInProgress(),
  });
}
