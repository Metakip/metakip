import * as stylex from '@stylexjs/stylex';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { actionColors } from '../components/ui/ActionColors.stylex';
import { LoadingIndicator } from '../components/ui/LoadingIndicator';
import { useAuth } from '../hooks/useAuth';
import { authClient } from '../lib/auth-client';
import { styles } from './OAuthAuthorize.stylex';

const READ_SCOPE = 'pages:read';
const COMMENT_SCOPE = 'pages:comment';
const WRITE_SCOPE = 'pages:write';
const PROTOCOL_SCOPES = new Set(['openid', 'profile', 'offline_access']);
const PAGE_SCOPES_ORDER = [READ_SCOPE, COMMENT_SCOPE, WRITE_SCOPE];
const PAGE_SCOPES = new Set(PAGE_SCOPES_ORDER);

type PublicClient = {
  client_id?: string;
  client_name?: string;
  client_uri?: string | null;
  redirect_uris?: string[];
};

function scopeLabel(scope: string): string {
  if (scope === READ_SCOPE) return 'Read Access';
  if (scope === COMMENT_SCOPE) return 'Comment Access';
  if (scope === WRITE_SCOPE) return 'Write Access';
  return scope;
}

function isPermissionScope(scope: string): boolean {
  return PAGE_SCOPES.has(scope);
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
  const requestsPageAccess = requestedScopes.some((scope) => PAGE_SCOPES.has(scope));
  const requestsCommentAccess = requestedScopes.some(
    (scope) => scope === COMMENT_SCOPE || scope === WRITE_SCOPE,
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
  const canConnect = selectedScopes.some((scope) => PAGE_SCOPES.has(scope));

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
      const selectedPageScope = [...PAGE_SCOPES_ORDER]
        .reverse()
        .find((scope) => requestedScopes.includes(scope) && selectedScopes.includes(scope));
      const grantedScopes = requestedScopes.filter(
        (scope) =>
          PROTOCOL_SCOPES.has(scope) ||
          (scope === selectedPageScope && selectedPageScope !== undefined),
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
      <div {...stylex.props(styles.loadingPage)}>
        <LoadingIndicator label="Loading authorization" size="md" />
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.authorizePage)}>
      <div {...stylex.props(styles.card)}>
        {loadError ? (
          <>
            <h1 {...stylex.props(styles.unavailableTitle)}>Authorization Unavailable</h1>
            <p {...stylex.props(styles.unavailableDescription)}>{loadError}</p>
            <button
              type="button"
              onClick={() => navigate('/app')}
              {...stylex.props(
                actionColors.subdued,
                styles.button,
                styles.primaryButton,
                styles.returnButton,
              )}
            >
              Return to Metakip
            </button>
          </>
        ) : client ? (
          <>
            <p {...stylex.props(styles.eyebrow)}>Connect application</p>
            <h1 {...stylex.props(styles.clientTitle)}>
              {client.client_name ?? client.client_id ?? 'Unknown application'}
            </h1>
            {clientWebsite ? (
              <p {...stylex.props(styles.website)}>
                Application website:{' '}
                <a
                  href={clientWebsite.href}
                  target="_blank"
                  rel="noreferrer"
                  {...stylex.props(styles.websiteLink)}
                >
                  {clientWebsite.hostname}
                </a>
              </p>
            ) : null}
            <p {...stylex.props(styles.requestDescription)}>
              {requestsPageAccess && requestsCommentAccess
                ? 'This application is requesting access to your Metakip pages, folders, and comments.'
                : requestsCommentAccess
                  ? 'This application is requesting access to your Metakip comments.'
                  : requestsPageAccess
                    ? 'This application is requesting access to your Metakip pages and folders.'
                    : 'This application is requesting account and session access.'}
            </p>
            <div {...stylex.props(styles.scopeList)}>
              {requestedPermissionScopes.map((scope) => (
                <label key={scope} {...stylex.props(styles.scopeOption)}>
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    disabled={isSubmitting}
                    onChange={(event) => {
                      const isChecked = event.currentTarget.checked;
                      setSelectedScopes((current) =>
                        isChecked
                          ? [
                              ...new Set([
                                ...current,
                                ...PAGE_SCOPES_ORDER.slice(
                                  0,
                                  PAGE_SCOPES_ORDER.indexOf(scope) + 1,
                                ).filter((item) => requestedPermissionScopes.includes(item)),
                              ]),
                            ]
                          : current.filter(
                              (item) =>
                                !PAGE_SCOPES.has(item) ||
                                PAGE_SCOPES_ORDER.indexOf(item) < PAGE_SCOPES_ORDER.indexOf(scope),
                            ),
                      );
                    }}
                    {...stylex.props(styles.checkbox)}
                  />
                  <span>
                    <span {...stylex.props(styles.scopeLabel)}>{scopeLabel(scope)}</span>
                  </span>
                </label>
              ))}
              {requestsOfflineAccess ? (
                <div {...stylex.props(styles.offlineNotice)}>
                  <p {...stylex.props(styles.offlineTitle)}>Stay connected when you are away</p>
                  <p {...stylex.props(styles.offlineDescription)}>
                    This application can remain connected after your browser session ends.
                  </p>
                </div>
              ) : null}
            </div>
            {submitError && <p {...stylex.props(styles.submitError)}>{submitError}</p>}
            <div {...stylex.props(styles.actions)}>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void submit(false)}
                {...stylex.props(styles.button, styles.cancelButton)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting || !canConnect}
                onClick={() => void submit(true)}
                {...stylex.props(actionColors.subdued, styles.button, styles.primaryButton)}
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
