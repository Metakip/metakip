import { invitationEmailConfiguration, requireInvitationEmailConfiguration } from '../env';
import type { InvitationPresentation } from './invitationPresentation';
import type { InvitationRecord } from './pendingInvitations';
import { buildPublicWebUrl } from './publicWebUrl';

const INVITATION_LIFETIME_DAYS = 7;

export class InvitationEmailError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvitationEmailError';
    this.retryable = retryable;
  }
}

export function isRetryableInvitationEmailError(error: unknown): boolean {
  return !(error instanceof InvitationEmailError) || error.retryable;
}

export function isInvitationEmailDeliveryAvailable(): boolean {
  const deliveryEnabled =
    process.env.NODE_ENV !== 'test' || process.env.RESEND_ENABLE_TEST_DELIVERY === 'true';
  return deliveryEnabled && invitationEmailConfiguration() !== null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function invitationEmailContent(
  invitation: InvitationRecord,
  presentation: InvitationPresentation,
  inviteUrl: string,
): { subject: string; text: string; html: string } {
  const { inviterName, targetTitle } = presentation;
  const targetKind = invitation.target_type === 'workspace' ? 'workspace' : invitation.target_type;
  const escapedInviter = escapeHtml(inviterName);
  const escapedTarget = escapeHtml(targetTitle);
  const escapedUrl = escapeHtml(inviteUrl);
  return {
    subject: `${inviterName.replace(/[\r\n]+/g, ' ')} invited you to ${targetTitle.replace(/[\r\n]+/g, ' ')} on Metakip`,
    text: `${inviterName} invited you to the ${targetKind} “${targetTitle}” on Metakip.\n\nAccept Invitation: ${inviteUrl}\n\nLink not opening in your browser? Copy and paste this URL: ${inviteUrl}\n\nThis invitation expires in ${INVITATION_LIFETIME_DAYS} days.`,
    html: `<p><strong>${escapedInviter}</strong> invited you to the ${targetKind} <strong>${escapedTarget}</strong> on Metakip.</p><p><a href="${escapedUrl}">Accept Invitation</a></p><p>Link not opening in your browser? Copy and paste this URL:</p><p><a href="${escapedUrl}">${escapedUrl}</a></p><p>This invitation expires in ${INVITATION_LIFETIME_DAYS} days.</p>`,
  };
}

export function renderInvitationEmail(
  invitation: InvitationRecord,
  presentation: InvitationPresentation,
  token: string,
): string {
  const { from } = requireInvitationEmailConfiguration();
  const inviteUrl = buildPublicWebUrl(`/invite/${encodeURIComponent(token)}`);
  return JSON.stringify({
    from,
    to: [invitation.email],
    ...invitationEmailContent(invitation, presentation, inviteUrl),
  });
}

export async function sendInvitationEmail(deliveryId: string, body: string): Promise<void> {
  if (!isInvitationEmailDeliveryAvailable()) {
    throw new InvitationEmailError('Invitation email delivery is not configured', true);
  }
  const { apiKey } = requireInvitationEmailConfiguration();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': deliveryId,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const retryable =
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500;
    throw new InvitationEmailError(
      `Resend rejected invitation email with status ${response.status}`,
      retryable,
    );
  }
}
