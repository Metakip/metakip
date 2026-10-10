import type { InvitationClaim } from '@metakip/shared';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { authClient } from '../lib/auth-client';
import { ApiError } from '../utils/api';
import { useAcceptInvitation, useDeclineInvitation, useInvitationClaim } from './use-invitations';
import { useAuth } from './useAuth';

type InvitationActionState =
  | { kind: 'declining' }
  | { kind: 'accepting' }
  | { kind: 'switching-account' }
  | { kind: 'email-mismatch'; message: string }
  | {
      kind: 'decision-error';
      attemptedAction: 'accept' | 'decline';
      message: string;
    };

export type InvitationRoutePhase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'awaiting-decision'; claim: InvitationClaim }
  | { kind: 'terminal'; claim: InvitationClaim }
  | (InvitationActionState & { claim: InvitationClaim });

type InvitationWorkflowState = { token: string; action: InvitationActionState } | null;

const pendingAcceptIntentKey = 'metakip:pending-invitation-accept';
const pendingAcceptIntentLifetimeMs = 15 * 60_000;

function rememberPendingAcceptIntent(token: string): void {
  try {
    window.sessionStorage.setItem(
      pendingAcceptIntentKey,
      JSON.stringify({ token, expiresAt: Date.now() + pendingAcceptIntentLifetimeMs }),
    );
  } catch {
    // If storage is unavailable, the recipient can still accept manually after sign-in.
  }
}

function takePendingAcceptIntent(token: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(pendingAcceptIntentKey);
    if (!raw) return false;
    window.sessionStorage.removeItem(pendingAcceptIntentKey);

    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return false;
    const intent = value as Record<string, unknown>;
    return (
      intent.token === token &&
      typeof intent.expiresAt === 'number' &&
      intent.expiresAt >= Date.now() &&
      intent.expiresAt - Date.now() <= pendingAcceptIntentLifetimeMs
    );
  } catch {
    return false;
  }
}

function clearPendingAcceptIntent(): void {
  try {
    window.sessionStorage.removeItem(pendingAcceptIntentKey);
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

function requestErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Invitation request failed';
}

function isTerminalInvitationActionError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 409 || error.status === 410)
  );
}

export function useInvitationController() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session, isPending: isSessionPending } = useAuth();
  const claimQuery = useInvitationClaim(token);
  const acceptMutation = useAcceptInvitation();
  const declineMutation = useDeclineInvitation();
  const [workflow, setWorkflow] = useState<InvitationWorkflowState>(null);

  const claim = claimQuery.data;
  const action = workflow?.token === token ? workflow?.action : undefined;
  const isContinuing =
    action?.kind === 'accepting' ||
    action?.kind === 'email-mismatch' ||
    action?.kind === 'switching-account';
  let phase: InvitationRoutePhase;
  if (!token) {
    phase = { kind: 'error', message: 'Invitation not found' };
  } else if (isSessionPending || claimQuery.isPending) {
    phase = { kind: 'loading' };
  } else if (claimQuery.error) {
    phase = { kind: 'error', message: requestErrorMessage(claimQuery.error) };
  } else if (!claim) {
    phase = { kind: 'error', message: 'Invitation not found' };
  } else if (
    claim.status !== 'pending' &&
    !(isContinuing && (claim.status === 'accepted' || claim.status === 'superseded'))
  ) {
    // Fresh server state always supersedes a recoverable local action error.
    phase = { kind: 'terminal', claim };
  } else if (action) {
    phase = { ...action, claim };
  } else {
    phase =
      claim.status === 'pending'
        ? { kind: 'awaiting-decision', claim }
        : { kind: 'terminal', claim };
  }

  const clearAction = useCallback(() => {
    setWorkflow((current) => (current?.token === token ? null : current));
  }, [token]);

  const accept = useCallback(async () => {
    if (
      !token ||
      !(
        phase.kind === 'awaiting-decision' ||
        phase.kind === 'decision-error' ||
        (phase.kind === 'terminal' &&
          (phase.claim.status === 'accepted' || phase.claim.status === 'superseded'))
      )
    ) {
      return;
    }
    if (!session?.user) {
      rememberPendingAcceptIntent(token);
      navigate('/login', { state: { from: location, invitationEmail: phase.claim.email } });
      return;
    }
    clearPendingAcceptIntent();
    setWorkflow({ token, action: { kind: 'accepting' } });
    try {
      const { destination } = await acceptMutation.mutateAsync(token);
      window.location.assign(destination);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVITATION_EMAIL_MISMATCH') {
        setWorkflow({ token, action: { kind: 'email-mismatch', message: error.message } });
        return;
      }
      if (isTerminalInvitationActionError(error)) {
        await claimQuery.refetch();
        clearAction();
        return;
      }
      setWorkflow({
        token,
        action: {
          kind: 'decision-error',
          attemptedAction: 'accept',
          message: requestErrorMessage(error),
        },
      });
    }
  }, [acceptMutation, claimQuery, clearAction, location, navigate, phase, session?.user, token]);

  useEffect(() => {
    if (!token || isSessionPending || claimQuery.isPending || !session?.user || !claim) return;
    if (phase.kind !== 'awaiting-decision') return;
    if (!takePendingAcceptIntent(token)) return;
    void accept();
  }, [accept, claim, claimQuery.isPending, isSessionPending, phase.kind, session?.user, token]);

  const switchAccount = useCallback(async () => {
    if (!token || phase.kind !== 'email-mismatch') return;
    setWorkflow({ token, action: { kind: 'switching-account' } });
    try {
      await authClient.signOut();
      rememberPendingAcceptIntent(token);
      navigate('/login', {
        state: { from: location, invitationEmail: phase.claim.email },
      });
    } catch {
      setWorkflow({
        token,
        action: { kind: 'email-mismatch', message: 'Could not sign out of the current account' },
      });
    }
  }, [location, navigate, phase, token]);

  const decline = useCallback(async () => {
    if (!token || (phase.kind !== 'awaiting-decision' && phase.kind !== 'decision-error')) {
      return;
    }
    clearPendingAcceptIntent();
    setWorkflow({ token, action: { kind: 'declining' } });
    try {
      await declineMutation.mutateAsync(token);
      clearAction();
    } catch (error) {
      if (isTerminalInvitationActionError(error)) {
        await claimQuery.refetch();
        clearAction();
        return;
      }
      setWorkflow({
        token,
        action: {
          kind: 'decision-error',
          attemptedAction: 'decline',
          message: requestErrorMessage(error),
        },
      });
    }
  }, [claimQuery, clearAction, declineMutation, phase.kind, token]);

  return { phase, accept, decline, switchAccount, isSignedIn: Boolean(session?.user) };
}
