import * as stylex from '@stylexjs/stylex';
import type React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { styles } from './RouteLoading.stylex';

type ProtectedRouteProps = {
  children: React.ReactNode;
};

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { data: session, isPending } = useAuth();
  const location = useLocation();

  if (isPending) {
    return (
      <div {...stylex.props(styles.root)}>
        <LoadingIndicator label="Loading application" size="md" />
      </div>
    );
  }

  if (!session?.user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
