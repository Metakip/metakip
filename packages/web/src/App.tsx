import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthIdentityBoundary } from './components/auth/AuthIdentityBoundary';
import { OnboardingGate } from './components/auth/OnboardingGate';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { ShareablePageRoute } from './components/auth/ShareablePageRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageLoadingState } from './components/editor/PageLoadingState';
import { ExplorerLoadingState } from './components/workspace/ExplorerLoadingState';
import { AuthSessionProvider } from './hooks/useAuth';
import Dashboard from './routes/Dashboard';
import FolderEntry from './routes/FolderEntry';
import Invitation from './routes/Invitation';
import Login from './routes/Login';
import OAuthAuthorize from './routes/OAuthAuthorize';
import Onboarding from './routes/Onboarding';
import PageEntry from './routes/PageEntry';
import Settings from './routes/Settings';
import SharedWithMe from './routes/SharedWithMe';
import Trash from './routes/Trash';
import { getLegacyWorkspacePath, getWorkspaceRoutePath, WORKSPACE_ROUTE_PATHS } from './utils/url';

function OnboardingIndexRedirect() {
  const location = useLocation();
  return <Navigate to="/onboarding/1" replace state={location.state} />;
}

function LegacyWorkspaceRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={getLegacyWorkspacePath(location.pathname, location.search, location.hash)}
      replace
    />
  );
}

function ApplicationRoutes() {
  const workspaceRoot = getWorkspaceRoutePath(WORKSPACE_ROUTE_PATHS.root);

  return (
    <Routes>
      <Route path="/app" element={<LegacyWorkspaceRedirect />} />
      <Route path="/app/*" element={<LegacyWorkspaceRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<Invitation />} />
      <Route path="/oauth/authorize" element={<OAuthAuthorize />} />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingIndexRedirect />
          </ProtectedRoute>
        }
      />
      <Route
        path="/onboarding/:onboardingStep"
        element={
          <ProtectedRoute>
            <Onboarding />
          </ProtectedRoute>
        }
      />

      <Route
        element={
          <OnboardingGate>
            <Outlet />
          </OnboardingGate>
        }
      >
        <Route
          path={workspaceRoot}
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path={WORKSPACE_ROUTE_PATHS.settings.slice(1)} element={<Settings />} />
          <Route path={WORKSPACE_ROUTE_PATHS.trash.slice(1)} element={<Trash />} />
          <Route path={WORKSPACE_ROUTE_PATHS.sharedWithMe.slice(1)} element={<SharedWithMe />} />
        </Route>

        <Route
          path={getWorkspaceRoutePath(WORKSPACE_ROUTE_PATHS.page)}
          element={<ShareablePageRoute entityType="page" loadingState={<PageLoadingState />} />}
        >
          <Route index element={<PageEntry />} />
        </Route>

        <Route
          path={getWorkspaceRoutePath(WORKSPACE_ROUTE_PATHS.folder)}
          element={
            <ShareablePageRoute entityType="folder" loadingState={<ExplorerLoadingState />} />
          }
        >
          <Route index element={<FolderEntry />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <div className="bg-white dark:bg-zinc-950 min-h-screen text-zinc-900 dark:text-zinc-50">
        <BrowserRouter>
          <AuthSessionProvider>
            <AuthIdentityBoundary>
              <ApplicationRoutes />
            </AuthIdentityBoundary>
          </AuthSessionProvider>
        </BrowserRouter>
      </div>
    </ErrorBoundary>
  );
}

export default App;
