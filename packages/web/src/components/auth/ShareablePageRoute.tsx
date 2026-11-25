import * as stylex from '@stylexjs/stylex';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileQuestion, RefreshCw, ShieldOff } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { ShareProvider } from '../../contexts/ShareContext';
import { invalidateWorkspaceAccessQueries } from '../../hooks/use-workspace';
import { useAuth } from '../../hooks/useAuth';
import {
  type ShareableSessionRevalidation,
  useShareableSessionRevalidation,
} from '../../hooks/useShareableSessionRevalidation';
import { ApiError } from '../../utils/api';
import {
  isFolderDetailPayload,
  parseShareableEntityPayload,
  type ShareableEntityPayload,
  type ShareableEntityType,
} from '../../utils/shareableEntityPayload';
import { AppShell, type AppShellContentState } from '../AppShell';
import { styles } from './ShareablePageRoute.stylex';

type EntityType = ShareableEntityType;
type PublicEntityPayload = ShareableEntityPayload;

function extractUuid(slugAndId: string): string | null {
  const match = slugAndId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] ?? null;
}

async function fetchEntity(entityType: EntityType, entityId: string): Promise<PublicEntityPayload> {
  const res = await fetch(`/api/${entityType === 'folder' ? 'folders' : 'pages'}/${entityId}`);
  if (!res.ok) {
    const body: unknown = await res.json();
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : `Failed to fetch ${entityType}`;
    throw new ApiError(res.status, message);
  }
  const payload: unknown = await res.json();
  return parseShareableEntityPayload(entityType, payload);
}

type ShareablePageRouteProps = {
  entityType: EntityType;
  loadingState: ReactElement;
};

function RouteRetryState({
  entityType,
  reason,
  onRetry,
}: {
  entityType: ShareableEntityType;
  reason: 'paused' | 'server';
  onRetry: () => void;
}) {
  return (
    <div {...stylex.props(styles.retryState)}>
      <h2 {...stylex.props(styles.stateTitle)}>Couldn&apos;t load this {entityType}</h2>
      <p {...stylex.props(styles.stateDescription)}>
        {reason === 'paused'
          ? 'Check your connection and try again.'
          : 'The server returned an error. Try again in a moment.'}
      </p>
      <button type="button" onClick={onRetry} {...stylex.props(styles.retryButton)}>
        <RefreshCw size={14} /> Retry
      </button>
    </div>
  );
}

function RouteErrorState({
  kind,
  entityType,
}: {
  kind: 'forbidden' | 'not-found';
  entityType: EntityType;
}) {
  const isForbidden = kind === 'forbidden';
  return (
    <div {...stylex.props(styles.errorPage)}>
      <div {...stylex.props(styles.errorState)}>
        {isForbidden ? (
          <ShieldOff size={48} {...stylex.props(styles.stateIcon)} />
        ) : (
          <FileQuestion size={48} {...stylex.props(styles.stateIcon)} />
        )}
        <h2 {...stylex.props(styles.stateTitle)}>
          {isForbidden
            ? `You don't have access`
            : `${entityType === 'folder' ? 'Folder' : 'Page'} not found`}
        </h2>
        <p {...stylex.props(styles.stateDescription)}>
          {isForbidden
            ? 'Your access may have been removed or the item may now be restricted.'
            : 'It may have been deleted.'}
        </p>
      </div>
    </div>
  );
}

type EntityQueryState =
  | { kind: 'loading' }
  | { kind: 'paused' }
  | { kind: 'unauthorized' }
  | { kind: 'not-found' }
  | { kind: 'error'; errorKind: 'forbidden' | 'not-found' | 'server' }
  | { kind: 'ready' };

type ShareableRouteState =
  | { kind: 'loading' }
  | { kind: 'retryable-error'; reason: 'paused' | 'server'; onRetry: () => void }
  | { kind: 'ready' }
  | { kind: 'redirect-login' }
  | { kind: 'not-found' }
  | {
      kind: 'error';
      errorKind: 'forbidden' | 'not-found';
    };

function resolveEntityQueryState({
  authPending,
  entityId,
  entity,
  isPending,
  isFetching,
  fetchStatus,
  isFetchedAfterMount,
  error,
}: {
  authPending: boolean;
  entityId: string | null;
  entity: PublicEntityPayload | undefined;
  isPending: boolean;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  isFetchedAfterMount: boolean;
  error: unknown;
}): EntityQueryState {
  if (authPending) return { kind: 'loading' };
  if (!entityId) return { kind: 'not-found' };

  const hasUsableEntity = entity !== undefined && (isFetchedAfterMount || fetchStatus !== 'paused');
  if (!hasUsableEntity && fetchStatus === 'paused') return { kind: 'paused' };
  if (!hasUsableEntity && (isPending || (isFetching && !isFetchedAfterMount))) {
    return { kind: 'loading' };
  }
  if (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status === 401) return { kind: 'unauthorized' };
    const errorKind = status === 403 ? 'forbidden' : status === 404 ? 'not-found' : 'server';
    return { kind: 'error', errorKind };
  }
  return entity === undefined ? { kind: 'loading' } : { kind: 'ready' };
}

function resolveShareableRouteState(
  entityState: EntityQueryState,
  sessionState: ShareableSessionRevalidation,
  retryEntity: () => void,
): ShareableRouteState {
  if (entityState.kind === 'unauthorized') {
    if (sessionState.status === 'error') {
      return {
        kind: 'retryable-error',
        reason: 'paused',
        onRetry: () => void sessionState.retry(),
      };
    }
    if (sessionState.status === 'logged-out') return { kind: 'redirect-login' };
    if (sessionState.status === 'forbidden') return { kind: 'error', errorKind: 'forbidden' };
    return { kind: 'loading' };
  }
  if (entityState.kind === 'paused') {
    return { kind: 'retryable-error', reason: 'paused', onRetry: retryEntity };
  }
  if (entityState.kind === 'not-found') return { kind: 'not-found' };
  if (entityState.kind === 'error') {
    if (entityState.errorKind === 'server') {
      return { kind: 'retryable-error', reason: 'server', onRetry: retryEntity };
    }
    return {
      kind: 'error',
      errorKind: entityState.errorKind,
    };
  }
  return entityState;
}

export function ShareablePageRoute({ entityType, loadingState }: ShareablePageRouteProps) {
  const auth = useAuth();
  const { isPending: authPending } = auth;
  const queryClient = useQueryClient();
  const location = useLocation();
  const { slugAndId } = useParams<{ slugAndId: string }>();
  const entityId = slugAndId ? extractUuid(slugAndId) : null;
  const {
    data: entity,
    isPending: isEntityPending,
    isFetching: isEntityFetching,
    fetchStatus: entityFetchStatus,
    isFetchedAfterMount: isEntityFetchedAfterMount,
    error,
    refetch,
  } = useQuery({
    queryKey: [entityType === 'folder' ? 'folders' : 'pages', 'detail', entityId],
    queryFn: () => {
      if (!entityId) throw new Error('entityId is required');
      return fetchEntity(entityType, entityId);
    },
    enabled: !authPending && !!entityId,
    retry: false,
    refetchInterval: entityType === 'folder' ? 5_000 : false,
    refetchIntervalInBackground: entityType === 'folder',
  });
  const folderAccessSignature = useMemo(() => {
    if (entityType !== 'folder' || !entityId || !entity) return null;
    return JSON.stringify({
      entityId,
      publicPermission: entity.publicPermission ?? null,
      userPermission: entity.userPermission ?? null,
      capabilities: entity.capabilities ?? null,
    });
  }, [entity, entityId, entityType]);
  const previousFolderAccessRef = useRef<{ entityId: string; signature: string } | null>(null);

  useEffect(() => {
    if (!entityId || folderAccessSignature === null) return;
    const previous = previousFolderAccessRef.current;
    previousFolderAccessRef.current = { entityId, signature: folderAccessSignature };
    if (previous?.entityId === entityId && previous.signature !== folderAccessSignature) {
      invalidateWorkspaceAccessQueries(queryClient);
    }
  }, [entityId, folderAccessSignature, queryClient]);

  const entityState = resolveEntityQueryState({
    authPending,
    entityId,
    entity,
    isPending: isEntityPending,
    isFetching: isEntityFetching,
    fetchStatus: entityFetchStatus,
    isFetchedAfterMount: isEntityFetchedAfterMount,
    error,
  });
  const sessionState = useShareableSessionRevalidation(
    entityId,
    entityState.kind === 'unauthorized',
    auth,
    refetch,
  );
  const routeState = resolveShareableRouteState(entityState, sessionState, () => void refetch());

  if (routeState.kind === 'redirect-login') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (routeState.kind === 'not-found') {
    return <RouteErrorState kind="not-found" entityType={entityType} />;
  }
  if (routeState.kind === 'error') {
    return <RouteErrorState kind={routeState.errorKind} entityType={entityType} />;
  }

  const providerEntity = routeState.kind === 'ready' ? entity : undefined;
  const shellContentState: AppShellContentState =
    routeState.kind === 'ready'
      ? { status: 'ready' }
      : {
          status: 'loading',
          content:
            routeState.kind === 'loading' ? (
              loadingState
            ) : (
              <RouteRetryState
                entityType={entityType}
                reason={routeState.reason}
                onRetry={routeState.onRetry}
              />
            ),
        };

  return (
    <ShareProvider
      key={`${entityType}:${entityId ?? 'invalid'}`}
      accessPending={routeState.kind !== 'ready'}
      publicPermission={providerEntity?.publicPermission ?? null}
      {...(providerEntity?.capabilities ? { capabilities: providerEntity.capabilities } : {})}
      publicEntity={
        entityType === 'folder' && isFolderDetailPayload(providerEntity) ? providerEntity : null
      }
    >
      <AppShell
        contentState={shellContentState}
        fullWidth
        hasToolbar={routeState.kind === 'ready'}
      />
    </ShareProvider>
  );
}
