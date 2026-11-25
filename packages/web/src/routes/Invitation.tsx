import type { InvitationClaim } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight, FileText, Folder, Home } from 'lucide-react';
import { HeaderActions } from '../components/HeaderActions';
import { actionColors } from '../components/ui/ActionColors.stylex';
import { LoadingIndicator } from '../components/ui/LoadingIndicator';
import {
  type InvitationRoutePhase,
  useInvitationController,
} from '../hooks/useInvitationController';
import { getMarketingWebsiteUrl } from '../utils/url';
import { styles } from './Invitation.stylex';

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
      <div {...stylex.props(styles.loadingPage)}>
        <LoadingIndicator label="Loading invitation" size="md" />
      </div>
    );
  }

  const claim = phase.kind === 'error' ? null : phase.claim;
  const status = invitationStatusCopy(phase);
  const TargetIcon =
    claim?.targetType === 'workspace' ? Home : claim?.targetType === 'folder' ? Folder : FileText;

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.headerActions)}>
        <HeaderActions />
      </div>

      <main {...stylex.props(styles.main)}>
        <div {...stylex.props(styles.content)}>
          <h1 {...stylex.props(styles.title)}>{status.title}</h1>
          <p {...stylex.props(styles.description)}>{status.description}</p>

          {claim && (
            <div {...stylex.props(styles.claim)}>
              <div {...stylex.props(styles.claimContent)}>
                <span {...stylex.props(styles.claimIcon)}>
                  <TargetIcon size={18} aria-hidden="true" />
                </span>
                <div {...stylex.props(styles.claimText)}>
                  <p {...stylex.props(styles.claimTitle)}>{claim.targetTitle}</p>
                  <p {...stylex.props(styles.claimDescription)}>
                    {targetLabel(claim.targetType)} · {permissionLabel(claim.permission)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {phase.kind === 'accepting' && (
            <div {...stylex.props(styles.acceptingStatus)}>
              <LoadingIndicator label="Accepting invitation" size="sm" />
              Accepting invitation…
            </div>
          )}

          <div {...stylex.props(styles.actions)}>
            {phase.kind === 'awaiting-decision' ||
            phase.kind === 'declining' ||
            phase.kind === 'decision-error' ? (
              <>
                <button
                  type="button"
                  disabled={phase.kind === 'declining'}
                  onClick={() => void decline()}
                  {...stylex.props(styles.actionButton, styles.secondaryButton)}
                >
                  {phase.kind === 'declining' ? 'Rejecting…' : 'Reject'}
                </button>
                <button
                  type="button"
                  disabled={phase.kind === 'declining'}
                  onClick={() => void accept()}
                  {...stylex.props(
                    actionColors.contrast,
                    styles.actionButton,
                    styles.primaryButton,
                  )}
                >
                  Accept Invitation
                </button>
              </>
            ) : phase.kind === 'email-mismatch' ? (
              <button
                type="button"
                onClick={() => void switchAccount()}
                {...stylex.props(actionColors.contrast, styles.actionButton, styles.primaryButton)}
              >
                Switch account
              </button>
            ) : phase.kind === 'switching-account' ? (
              <button
                type="button"
                disabled
                {...stylex.props(actionColors.contrast, styles.actionButton, styles.primaryButton)}
              >
                Switching accounts…
              </button>
            ) : phase.kind === 'accepting' ? (
              <button
                type="button"
                disabled
                {...stylex.props(actionColors.contrast, styles.actionButton, styles.primaryButton)}
              >
                Accepting invitation…
              </button>
            ) : phase.kind === 'terminal' &&
              (phase.claim.status === 'accepted' || phase.claim.status === 'superseded') ? (
              <button
                type="button"
                onClick={() => void accept()}
                {...stylex.props(actionColors.contrast, styles.actionButton, styles.primaryButton)}
              >
                {isSignedIn ? 'Continue' : 'Sign in to continue'}
              </button>
            ) : (
              <a
                href={getMarketingWebsiteUrl()}
                {...stylex.props(
                  actionColors.contrast,
                  styles.actionButton,
                  styles.primaryButton,
                  styles.learnLink,
                )}
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
