import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { type OnboardingStatus, useOnboardingStatus } from '../../hooks/useOnboarding';
import { actionColors } from '../ui/ActionColors.stylex';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { styles } from './AuthBoundary.stylex';
import { styles as loadingStyles } from './RouteLoading.stylex';

type OnboardingStatusBoundaryProps = {
  children: (status: OnboardingStatus) => ReactNode;
};

export function OnboardingStatusBoundary({ children }: OnboardingStatusBoundaryProps) {
  const onboardingStatus = useOnboardingStatus();

  if (onboardingStatus.isPending) {
    return (
      <div {...stylex.props(loadingStyles.root)}>
        <LoadingIndicator label="Preparing your workspace" size="md" />
      </div>
    );
  }

  if (onboardingStatus.isError) {
    return (
      <div {...stylex.props(styles.centered, styles.onboardingErrorRoot)}>
        <div {...stylex.props(styles.onboardingErrorPanel)}>
          <h1 {...stylex.props(styles.errorTitle)}>We could not prepare your workspace</h1>
          <p {...stylex.props(styles.errorCopy, styles.onboardingErrorCopy)}>
            Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => void onboardingStatus.refetch()}
            {...stylex.props(actionColors.contrast, styles.tryAgainButton)}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!onboardingStatus.data) {
    throw new Error('Onboarding status resolved without data');
  }

  return <>{children(onboardingStatus.data)}</>;
}
