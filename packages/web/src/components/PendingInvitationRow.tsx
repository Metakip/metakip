import type { PendingInvitation } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { Mail, RotateCw, Trash2 } from 'lucide-react';
import { useResendInvitation, useRevokeInvitation } from '../hooks/use-invitations';
import { AccessTableRow } from './access/AccessTable';
import { styles } from './PendingInvitationRow.stylex';
import { KebabMenu } from './ui/KebabMenu';

const DELIVERY_STATUS_PRESENTATION = {
  pending: {
    label: 'Queued',
    style: styles.pending,
  },
  sent: {
    label: 'Sent',
    style: styles.sent,
  },
  failed: {
    label: 'Delivery failed',
    style: styles.failed,
  },
};

export function PendingInvitationRow({
  invitation,
  permissionLabel,
}: {
  invitation: PendingInvitation;
  permissionLabel: string;
}) {
  const resendMutation = useResendInvitation();
  const revokeMutation = useRevokeInvitation();
  const isMutating = resendMutation.isPending || revokeMutation.isPending;
  const deliveryPresentation = DELIVERY_STATUS_PRESENTATION[invitation.deliveryStatus];

  return (
    <AccessTableRow>
      <div {...stylex.props(styles.invitation)}>
        <div {...stylex.props(styles.icon)}>
          <Mail size={12} />
        </div>
        <p {...stylex.props(styles.email)}>{invitation.email}</p>
      </div>
      <span {...stylex.props(styles.permission)}>{permissionLabel}</span>
      <div {...stylex.props(styles.controls)}>
        <span {...stylex.props(styles.deliveryBadge, deliveryPresentation.style)}>
          {deliveryPresentation.label}
        </span>
        {invitation.canManage && (
          <KebabMenu
            triggerStyle={styles.menuTrigger}
            items={[
              {
                label: 'Resend invitation',
                icon: <RotateCw size={14} />,
                onClick: () => resendMutation.mutate(invitation.id),
                disabled: isMutating,
              },
              {
                label: 'Revoke invitation',
                icon: <Trash2 size={14} />,
                onClick: () => revokeMutation.mutate(invitation.id),
                disabled: isMutating,
                variant: 'destructive',
              },
            ]}
          />
        )}
      </div>
    </AccessTableRow>
  );
}
