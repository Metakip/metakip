import * as stylex from '@stylexjs/stylex';
import React from 'react';
import { getLogger } from '../logger-init';
import { styles } from './ErrorBoundary.stylex';
import { actionColors } from './ui/ActionColors.stylex';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    getLogger().error(error.message, { stack: error.stack, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div {...stylex.props(styles.root)}>
        <div {...stylex.props(styles.card)}>
          <h1 {...stylex.props(styles.title)}>Something went wrong</h1>
          <p {...stylex.props(styles.description)}>
            The page crashed while rendering. You can safely return home.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/';
            }}
            {...stylex.props(actionColors.contrast, styles.action)}
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }
}
