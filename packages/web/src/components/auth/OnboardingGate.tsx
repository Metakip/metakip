import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getWorkspaceDestination } from '../../utils/onboardingNavigation';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { OnboardingStatusBoundary } from './OnboardingStatusBoundary';
import { styles } from './RouteLoading.stylex';

type OnboardingGateProps = {
  children: ReactNode;
};

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { data: session, isPending } = useAuth();
  const location = useLocation();

  if (isPending) {
    return (
      <div {...stylex.props(styles.root)}>
        <LoadingIndicator label="Loading application" size="md" />
      </div>
    );
  }

  // Public page and folder links remain available without an account. Every
  // authenticated workspace entry point is checked below.
  if (!session?.user) return <>{children}</>;

  return (
    <OnboardingStatusBoundary>
      {(onboardingStatus) => {
        if (!onboardingStatus.completed) {
          return (
            <Navigate
              to="/onboarding/1"
              replace
              state={{ destination: getWorkspaceDestination(location) }}
            />
          );
        }

        return <>{children}</>;
      }}
    </OnboardingStatusBoundary>
  );
}
