import type { SharePermission } from '@metakip/shared';
import type { AuthenticatedCredential } from './authenticatedCredential';
import type { ConnectionLifecycle } from './connectionLifecycle';

const collabSessionBrand: unique symbol = Symbol('metakip.collabSession');

type SessionBase = {
  readonly [collabSessionBrand]: true;
  lifecycle: ConnectionLifecycle;
  permission: SharePermission | null;
  accessRevision: string;
};

export type AccountCollabSession = SessionBase & {
  principal: {
    kind: 'account';
    user: {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
    };
    credential: AuthenticatedCredential;
  };
};

export type AnonymousCollabSession = SessionBase & {
  principal: {
    kind: 'anonymous';
    user: { id: string; name: string };
    sessionToken: `anon:${string}`;
  };
};

export type CollabSession = AccountCollabSession | AnonymousCollabSession;

type NewCollabSession =
  | Omit<AccountCollabSession, typeof collabSessionBrand>
  | Omit<AnonymousCollabSession, typeof collabSessionBrand>;

/** Brand the authentication result that Hocuspocus carries between hooks. */
export function createCollabSession(session: NewCollabSession): CollabSession {
  return { ...session, [collabSessionBrand]: true as const };
}

export function isCollabSession(value: unknown): value is CollabSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [collabSessionBrand]?: unknown })[collabSessionBrand] === true
  );
}

export function getSessionUser(session: CollabSession) {
  return session.principal.user;
}

export function getSessionToken(session: CollabSession): string {
  return session.principal.kind === 'account'
    ? session.principal.credential.raw
    : session.principal.sessionToken;
}

export function getAuthenticatedCredential(session: CollabSession): AuthenticatedCredential {
  if (session.principal.kind !== 'account') {
    throw new Error('Anonymous collaboration sessions do not have authenticated credentials');
  }
  return session.principal.credential;
}

export function isAnonymousSession(session: CollabSession): session is AnonymousCollabSession {
  return session.principal.kind === 'anonymous';
}

export async function waitForPermissionChecks(session: CollabSession): Promise<void> {
  await session.lifecycle.permissionChecks.tail.catch(() => undefined);
}

export async function waitForWriteApplications(session: CollabSession): Promise<void> {
  const application = session.lifecycle.application;
  if (application.state === 'running') await application.completion.catch(() => undefined);
}
