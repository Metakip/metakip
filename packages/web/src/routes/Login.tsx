import { Navigate, useLocation } from 'react-router-dom';
import { HeaderActions } from '../components/HeaderActions';
import { LoadingIndicator } from '../components/ui/LoadingIndicator';
import { useIdentityLifecycle } from '../contexts/IdentityLifecycleContext';
import { useAuth } from '../hooks/useAuth';
import { authClient } from '../lib/auth-client';
import { getWorkspaceRootPath } from '../utils/url';

export default function Login() {
  const { data: session, isPending, isRefetching } = useAuth();
  const identityLifecycle = useIdentityLifecycle();
  const location = useLocation();
  const locationState = location.state as {
    from?: { pathname?: unknown; search?: unknown; hash?: unknown };
    invitationEmail?: unknown;
  } | null;
  const returnLocation = locationState?.from;
  const invitationEmail =
    typeof locationState?.invitationEmail === 'string' ? locationState.invitationEmail : undefined;
  const returnPath =
    typeof returnLocation?.pathname === 'string' && returnLocation.pathname.startsWith('/')
      ? `${returnLocation.pathname}${typeof returnLocation.search === 'string' ? returnLocation.search : ''}${typeof returnLocation.hash === 'string' ? returnLocation.hash : ''}`
      : getWorkspaceRootPath();

  if (isPending || isRefetching) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-zinc-950">
        <LoadingIndicator label="Loading application" size="md" />
      </div>
    );
  }

  if (session?.user) {
    return <Navigate to={returnPath} replace />;
  }

  const handleSocialSignIn = (provider: 'github' | 'google') => async () => {
    try {
      await authClient.signIn.social({
        provider,
        ...(provider === 'google' && invitationEmail
          ? { additionalParams: { login_hint: invitationEmail } }
          : {}),
        callbackURL: returnPath,
        errorCallbackURL: '/login',
      });
    } catch {
      if (!identityLifecycle.isActive()) return;
      window.location.assign('/login');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="absolute top-4 right-4">
        <HeaderActions />
      </div>
      <div className="w-full max-w-sm animate-fade-in rounded-lg border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-2 text-center text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Log In
        </h1>
        <p className="mb-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          Continue with your preferred provider.
        </p>
        <div className="space-y-3">
          <button
            type="button"
            onClick={handleSocialSignIn('google')}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <title>Google</title>
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>
          <button
            type="button"
            onClick={handleSocialSignIn('github')}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 cursor-pointer"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <title>GitHub</title>
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            Continue with GitHub
          </button>
        </div>
      </div>
    </div>
  );
}
