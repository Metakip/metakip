import type { PendingInvitation } from '@metakip/shared';
import { Mail, RotateCw, Trash2 } from 'lucide-react';
import { useResendInvitation, useRevokeInvitation } from '../hooks/use-invitations';
import { KebabMenu } from './ui/KebabMenu';

const DELIVERY_STATUS_PRESENTATION = {
  pending: {
    label: 'Queued',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  },
  sent: {
    label: 'Sent',
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  failed: {
    label: 'Delivery failed',
    className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  },
} satisfies Record<PendingInvitation['deliveryStatus'], { label: string; className: string }>;

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
    <div className="grid grid-cols-[minmax(0,1.2fr)_0.5fr_0.7fr] items-center gap-2 border-b border-zinc-200 px-3 py-1.5 last:border-b-0 dark:border-zinc-800">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          <Mail size={12} />
        </div>
        <p className="max-w-[18ch] truncate text-sm text-zinc-900 dark:text-zinc-100">
          {invitation.email}
        </p>
      </div>
      <span className="text-xs text-zinc-600 dark:text-zinc-300">{permissionLabel}</span>
      <div className="flex min-w-0 items-center justify-between gap-1.5">
        <span
          className={`truncate rounded-full px-2 py-0.5 text-[10px] font-medium ${deliveryPresentation.className}`}
        >
          {deliveryPresentation.label}
        </span>
        {invitation.canManage && (
          <KebabMenu
            triggerClassName="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
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
                className: 'hover:text-red-600 dark:hover:text-red-400',
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
