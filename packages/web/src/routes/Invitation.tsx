import type { InvitationClaim } from '@metakip/shared';
import { ArrowRight, FileText, Folder, Home } from 'lucide-react';
import { HeaderActions } from '../components/HeaderActions';
import { LoadingIndicator } from '../components/ui/LoadingIndicator';
import {
  type InvitationRoutePhase,
  useInvitationController,
} from '../hooks/useInvitationController';
import { getMarketingWebsiteUrl } from '../utils/url';

function permissionLabel(permission: InvitationClaim['permission']): string {
  if (permission === 'admin') return 'Admin';
  if (permission === 'edit' || permission === 'editor') return 'Editor';
  if (permission === 'commenter') return 'Commenter';
  return 'Viewer';
}

function targetLabel(targetType: InvitationClaim['targetType']): string {
  if (targetType === 'workspace') return 'Workspace';
  if (targetType === 'folder') return 'Folder';
  return 'Page';
}

function invitationStatusCopy(phase: Exclude<InvitationRoutePhase, { kind: 'loading' }>): {
  title: string;
  description: string;
} {
  if (phase.kind === 'error') {
    return {
      title: 'We could not open this invitation',
      description: phase.message,
    };
  }
  if (phase.kind === 'email-mismatch') {
    return {
      title: 'Use the invited account',
      description: `${phase.message} Sign in with ${phase.claim.email} to accept this invitation.`,
    };
  }
  if (phase.kind === 'switching-account') {
    return {
      title: 'Switching accounts',
      description: `Signing out so you can continue with ${phase.claim.email}.`,
    };
  }
  if (phase.kind === 'decision-error') {
    return {
      title:
        phase.attemptedAction === 'accept'
          ? 'We could not accept this invitation'
          : 'We could not reject this invitation',
      description: phase.message,
    };
  }
  const claim = phase.claim;
  if (claim.status === 'expired') {
    return {
      title: 'This invitation has expired',
      description: `Ask ${claim.inviterName} to send you a new invitation.`,
    };
  }
  if (claim.status === 'revoked') {
    return {
      title: 'This invitation has been revoked',
      description: `${claim.inviterName} revoked this invitation. Ask them to send a new one if this was unexpected.`,
    };
  }
  if (claim.status === 'superseded') {
    return {
      title: 'Access was granted directly',
      description: 'This invitation is no longer needed. Sign in to continue to Metakip.',
    };
  }
  if (claim.status === 'declined') {
    return {
      title: 'Invitation declined',
      description: `You declined ${claim.inviterName}'s invitation.`,
    };
  }
  if (claim.status === 'accepted' && phase.kind === 'terminal') {
    return {
      title: 'You already accepted this invitation',
      description: 'Sign in to continue to Metakip.',
    };
  }
  if (phase.kind === 'awaiting-decision' || phase.kind === 'declining') {
    return {
      title: `${claim.inviterName} invited you to collaborate`,
      description: `Accept this invitation to continue with ${claim.email}.`,
    };
  }
  return {
    title: `Opening ${claim.targetTitle}`,
    description: `Setting up the access ${claim.inviterName} shared with you.`,
  };
}

export default function Invitation() {
  const { phase, accept, decline, switchAccount, isSignedIn } = useInvitationController();

  if (phase.kind === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-zinc-950">
        <LoadingIndicator label="Loading invitation" size="md" />
      </div>
    );
  }

  const claim = phase.kind === 'error' ? null : phase.claim;
  const status = invitationStatusCopy(phase);
  const TargetIcon =
    claim?.targetType === 'workspace' ? Home : claim?.targetType === 'folder' ? Folder : FileText;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="absolute top-4 right-4">
        <HeaderActions />
      </div>

      <main className="grid min-h-screen place-items-center px-5 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-xl animate-fade-in">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
            {status.title}
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {status.description}
          </p>

          {claim && (
            <div className="mt-8 border-y border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-4 py-4">
                <span className="flex size-8 shrink-0 items-center justify-center text-zinc-500 dark:text-zinc-400">
                  <TargetIcon size={18} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {claim.targetTitle}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {targetLabel(claim.targetType)} · {permissionLabel(claim.permission)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {phase.kind === 'accepting' && (
            <div className="mt-5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <LoadingIndicator label="Accepting invitation" size="sm" />
              Accepting invitation…
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {phase.kind === 'awaiting-decision' ||
            phase.kind === 'declining' ||
            phase.kind === 'decision-error' ? (
              <>
                <button
                  type="button"
                  disabled={phase.kind === 'declining'}
                  onClick={() => void decline()}
                  className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {phase.kind === 'declining' ? 'Rejecting…' : 'Reject'}
                </button>
                <button
                  type="button"
                  disabled={phase.kind === 'declining'}
                  onClick={() => void accept()}
                  className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  Accept Invitation
                </button>
              </>
            ) : phase.kind === 'email-mismatch' ? (
              <button
                type="button"
                onClick={() => void switchAccount()}
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Switch account
              </button>
            ) : phase.kind === 'switching-account' ? (
              <button
                type="button"
                disabled
                className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Switching accounts…
              </button>
            ) : phase.kind === 'accepting' ? (
              <button
                type="button"
                disabled
                className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Accepting invitation…
              </button>
            ) : phase.kind === 'terminal' &&
              (phase.claim.status === 'accepted' || phase.claim.status === 'superseded') ? (
              <button
                type="button"
                onClick={() => void accept()}
                className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {isSignedIn ? 'Continue' : 'Sign in to continue'}
              </button>
            ) : (
              <a
                href={getMarketingWebsiteUrl()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Learn about Metakip
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
