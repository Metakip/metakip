import * as stylex from '@stylexjs/stylex';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useLayoutEffect, useMemo, useRef } from 'react';
import {
  createIdentityLifecycle,
  IdentityLifecycleProvider,
} from '../../contexts/IdentityLifecycleContext';
import { useAuth } from '../../hooks/useAuth';
import { createQueryClient, retireQueryClient } from '../../lib/query-client';
import { resetBulkRemovalState } from '../../utils/bulkRemovalState';
import { resetDocumentMetadata } from '../../utils/documentMeta';
import { resetSelfLeaveState } from '../../utils/leave-page';
import { clearToasts } from '../../utils/toast';
import { AppProviders } from '../AppProviders';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { styles } from './AuthBoundary.stylex';
import { styles as loadingStyles } from './RouteLoading.stylex';

const ANONYMOUS_IDENTITY = 'anonymous';

function IdentityLoadingState() {
  return (
    <div {...stylex.props(loadingStyles.root)}>
      <LoadingIndicator label="Loading application" size="md" />
    </div>
  );
}

function IdentityErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div {...stylex.props(styles.centered)}>
      <div {...stylex.props(styles.errorPanel)}>
        <h2 {...stylex.props(styles.errorTitle)}>Couldn&apos;t load your session</h2>
        <p {...stylex.props(styles.errorCopy)}>Check your connection and try again.</p>
        <button type="button" onClick={onRetry} {...stylex.props(styles.retryButton)}>
          Retry
        </button>
      </div>
    </div>
  );
}

/**
 * Prevents state owned by one authenticated identity from being observed by
 * the next identity in the same browser tab. Each resolved identity receives
 * an independent QueryClient, while the prior client and other process-local
 * UI state are retired before the new route tree can be painted.
 */
export function AuthIdentityBoundary({ children }: { children: ReactNode }) {
  const {
    data: session,
    error: sessionError = null,
    isInitialError = false,
    isPending,
    isRefetching,
    refetch,
  } = useAuth();
  const parentQueryClient = useQueryClient();
  const sessionIdentity = session?.user?.id ?? ANONYMOUS_IDENTITY;
  const isTransientSessionError = sessionError !== null && sessionError.status !== 401;
  const lastSettledIdentityRef = useRef<string | null>(
    !isPending && !isRefetching && !isTransientSessionError ? sessionIdentity : null,
  );
  const resolvedIdentity =
    isPending || isRefetching || isTransientSessionError
      ? lastSettledIdentityRef.current
      : sessionIdentity;
  const identityUncertain = resolvedIdentity === null;
  const identityQueryClient = useMemo(
    () =>
      resolvedIdentity === null ? null : createQueryClient(parentQueryClient.getDefaultOptions()),
    [parentQueryClient, resolvedIdentity],
  );
  const identityLifecycle = useMemo(
    () => (resolvedIdentity === null ? null : createIdentityLifecycle()),
    [resolvedIdentity],
  );
  const previousIdentityRef = useRef<string | null>(null);
  const previousQueryClientRef = useRef(identityQueryClient);
  const previousLifecycleRef = useRef(identityLifecycle);

  useLayoutEffect(() => {
    if (!isPending && !isRefetching && !isTransientSessionError) {
      lastSettledIdentityRef.current = sessionIdentity;
    }
  }, [isPending, isRefetching, isTransientSessionError, sessionIdentity]);

  useLayoutEffect(() => {
    const previousLifecycle = previousLifecycleRef.current;
    if (previousLifecycle && previousLifecycle !== identityLifecycle) {
      previousLifecycle.retire();
    }
    previousLifecycleRef.current = identityLifecycle;

    const previousQueryClient = previousQueryClientRef.current;
    if (previousQueryClient && previousQueryClient !== identityQueryClient) {
      retireQueryClient(previousQueryClient);
    }
    previousQueryClientRef.current = identityQueryClient;

    const identityChanged = previousIdentityRef.current !== resolvedIdentity;
    previousIdentityRef.current = resolvedIdentity;
    if (identityChanged) {
      clearToasts();
      resetDocumentMetadata();
      resetSelfLeaveState();
      resetBulkRemovalState();
      window.getSelection()?.removeAllRanges();
    }
  }, [identityLifecycle, identityQueryClient, resolvedIdentity]);

  if (
    !isPending &&
    !isRefetching &&
    (isInitialError || (identityUncertain && isTransientSessionError))
  ) {
    return <IdentityErrorState onRetry={() => void refetch()} />;
  }

  if (
    identityUncertain ||
    resolvedIdentity === null ||
    identityQueryClient === null ||
    identityLifecycle === null
  ) {
    return <IdentityLoadingState />;
  }

  return (
    <IdentityLifecycleProvider lifecycle={identityLifecycle}>
      <QueryClientProvider client={identityQueryClient}>
        <AppProviders key={resolvedIdentity}>{children}</AppProviders>
      </QueryClientProvider>
    </IdentityLifecycleProvider>
  );
}
