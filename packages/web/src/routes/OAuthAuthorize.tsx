import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LoadingIndicator } from '../components/ui/LoadingIndicator';
import { useAuth } from '../hooks/useAuth';
import { authClient } from '../lib/auth-client';

const READ_SCOPE = 'pages:read';
const WRITE_SCOPE = 'pages:write';
const PROTOCOL_SCOPES = new Set(['openid', 'profile', 'offline_access']);

type PublicClient = {
  client_id?: string;
  client_name?: string;
  client_uri?: string | null;
  redirect_uris?: string[];
};

function scopeLabel(scope: string): string {
  if (scope === READ_SCOPE) return 'Read pages and folders';
  if (scope === WRITE_SCOPE) return 'Modify pages and folders';
  return scope;
}

function isPermissionScope(scope: string): boolean {
  return scope === READ_SCOPE || scope === WRITE_SCOPE;
}

function isSupportedConsentScope(scope: string): boolean {
  return PROTOCOL_SCOPES.has(scope) || isPermissionScope(scope);
}

function safeClientWebsite(
  value: string | null | undefined,
): { href: string; hostname: string } | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return { href: parsed.href, hostname: parsed.hostname };
  } catch {
    return null;
  }
}

function asPublicClient(value: unknown): PublicClient {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.client_id === 'string' ? { client_id: record.client_id } : {}),
    ...(typeof record.client_name === 'string' ? { client_name: record.client_name } : {}),
    ...(record.client_uri === null || typeof record.client_uri === 'string'
      ? { client_uri: record.client_uri }
      : {}),
    ...(Array.isArray(record.redirect_uris) &&
    record.redirect_uris.every((uri) => typeof uri === 'string')
      ? { redirect_uris: record.redirect_uris }
      : {}),
  };
}

export default function OAuthAuthorize() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session, isPending } = useAuth();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const clientId = params.get('client_id');
  const requestedScopeValue = params.get('scope') ?? '';
  const requestedScopes = useMemo(
    () => requestedScopeValue.split(' ').filter(Boolean),
    [requestedScopeValue],
  );
  const requestedPermissionScopes = useMemo(
    () => requestedScopes.filter(isPermissionScope),
    [requestedScopes],
  );
  const requestsOfflineAccess = requestedScopes.includes('offline_access');
  const [client, setClient] = useState<PublicClient | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(() =>
    requestedScopes.filter(isSupportedConsentScope),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const clientWebsite = useMemo(() => safeClientWebsite(client?.client_uri), [client?.client_uri]);

  useEffect(() => {
    setSelectedScopes(
      requestedScopeValue.split(' ').filter(Boolean).filter(isSupportedConsentScope),
    );
    setSubmitError(null);
    setIsSubmitting(false);
  }, [requestedScopeValue]);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      navigate('/login', {
        replace: true,
        state: { from: { pathname: '/oauth/authorize', search: location.search } },
      });
      return;
    }
    if (!clientId) {
      setLoadError('The authorization request is missing a client ID.');
      return;
    }

    setLoadError(null);
    setClient(null);
    let cancelled = false;
    const query = new URLSearchParams({ client_id: clientId });
    void fetch(`/api/auth/oauth2/public-client?${query.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('This authorization request is invalid or expired.');
        return asPublicClient(await response.json());
      })
      .then((value) => {
        if (!cancelled) {
          setLoadError(null);
          setClient(value);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setLoadError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to load authorization request.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, isPending, location.search, navigate, session?.user]);

  const submit = async (accept: boolean) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const grantedScopes = requestedScopes.filter(
        (scope) => PROTOCOL_SCOPES.has(scope) || selectedScopes.includes(scope),
      );
      // The Better Auth client forwards the signed flat page query. Never accept
      // an independent nested oauth_query that could differ from this UI.
      const result = await authClient.oauth2.consent({
        accept,
        ...(accept ? { scope: grantedScopes.join(' ') } : {}),
      });
      if (result.error)
        throw new Error(result.error.message ?? 'Unable to complete authorization.');
      const redirectUri = result.data?.url;
      if (!result.data?.redirect || typeof redirectUri !== 'string') {
        throw new Error('The authorization response did not include a redirect URI.');
      }
      window.location.assign(redirectUri);
    } catch (submitError: unknown) {
      setIsSubmitting(false);
      setSubmitError(
        submitError instanceof Error ? submitError.message : 'Unable to complete authorization.',
      );
    }
  };

  if (isPending || (!client && !loadError)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <LoadingIndicator label="Loading authorization" size="md" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-7 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {loadError ? (
          <>
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Authorization Unavailable
            </h1>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{loadError}</p>
            <button
              type="button"
              onClick={() => navigate('/app')}
              className="mt-6 cursor-pointer rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-700 dark:hover:bg-zinc-600"
            >
              Return to Metakip
            </button>
          </>
        ) : client ? (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Connect application
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {client.client_name ?? client.client_id ?? 'Unknown application'}
            </h1>
            {clientWebsite ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Application website:{' '}
                <a
                  href={clientWebsite.href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline"
                >
                  {clientWebsite.hostname}
                </a>
              </p>
            ) : null}
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              This application is requesting access to your Metakip pages and folders.
            </p>
            <div className="mt-6 space-y-3">
              {requestedPermissionScopes.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    disabled={scope === READ_SCOPE || isSubmitting}
                    onChange={(event) =>
                      setSelectedScopes((current) =>
                        event.target.checked
                          ? [...current, scope]
                          : current.filter((item) => item !== scope),
                      )
                    }
                    className="mt-0.5 h-4 w-4 cursor-pointer"
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {scopeLabel(scope)}
                    </span>
                  </span>
                </label>
              ))}
              {requestsOfflineAccess ? (
                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Stay connected when you are away
                  </p>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    This application can remain connected after your browser session ends.
                  </p>
                </div>
              ) : null}
            </div>
            {submitError && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{submitError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void submit(false)}
                className="cursor-pointer rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting || !selectedScopes.includes(READ_SCOPE)}
                onClick={() => void submit(true)}
                className="cursor-pointer rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:hover:bg-zinc-600"
              >
                {isSubmitting ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
