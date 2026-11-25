import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import type { ShareEntityType, SharePermission } from '@metakip/shared';
import * as stylex from '@stylexjs/stylex';
import { Check, Copy, Globe2, Lock, Shield, UserRound, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useIdentityLifecycle } from '../../contexts/IdentityLifecycleContext';
import {
  useGrantEntityAccess,
  useRemoveGrant,
  useShareSummary,
  useUpdateGrantPermission,
  useUpdateInheritancePolicy,
  useUpdatePublicPermission,
} from '../../hooks/use-share';
import { useAuth } from '../../hooks/useAuth';
import { getInitial } from '../../utils/avatar';
import { consumeSelfLeave, markSelfLeave } from '../../utils/leave-page';
import { showErrorToast, showSuccessToast } from '../../utils/toast';
import { AccessLoadError, AccessSectionHeading, InviteAccessForm } from '../access/AccessControls';
import { styles as accessStyles } from '../access/AccessControls.stylex';
import { AccessTable, AccessTableMessage, AccessTableRow } from '../access/AccessTable';
import { PendingInvitationRow } from '../PendingInvitationRow';
import { actionColors } from '../ui/ActionColors.stylex';
import { ChoiceGroup, Dropdown, TextBox } from '../ui/FormControls';
import { styles } from './ShareDialog.stylex';

type ShareDialogProps = {
  entityType: ShareEntityType;
  entityId: string;
  title: string;
  onClose: () => void;
};

const permissionOptions: Array<{
  value: 'view' | 'edit' | 'private';
  label: string;
}> = [
  { value: 'private', label: 'Restricted' },
  { value: 'view', label: 'Anyone Can View' },
  { value: 'edit', label: 'Anyone Can Edit' },
];

type AccessEntry = {
  key: string;
  grantId: string | null;
  id: string;
  name: string;
  avatarUrl: string | null;
  permission: SharePermission;
  effectivePermission: SharePermission;
  isWinning: boolean;
  isManageable: boolean;
  kind: 'owner' | 'direct' | 'folder' | 'workspace';
  source: string;
  isOwner: boolean;
};

function permissionLabel(permission: SharePermission): string {
  if (permission === 'admin') return 'Admin';
  if (permission === 'edit') return 'Edit';
  if (permission === 'commenter') return 'Comment';
  return 'View';
}

function CollaboratorIdentity({
  name,
  avatarUrl,
  displayName,
}: {
  name: string | null;
  avatarUrl: string | null;
  displayName: string;
}) {
  return (
    <div {...stylex.props(styles.collaboratorIdentity)}>
      <div
        {...stylex.props(styles.avatar)}
        style={{ backgroundColor: avatarUrl ? undefined : '#71717a' }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name ?? ''}
            {...stylex.props(styles.avatarImage)}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span {...stylex.props(styles.avatarInitial)}>{getInitial(name ?? 'Unknown user')}</span>
        )}
      </div>
      <p {...stylex.props(styles.displayName)}>{displayName}</p>
    </div>
  );
}

export function ShareDialog({ entityType, entityId, title, onClose }: ShareDialogProps) {
  const identityLifecycle = useIdentityLifecycle();
  const { data: session } = useAuth();
  const currentUserId = session?.user?.id;
  const [email, setEmail] = useState('');
  const [grantPermission, setGrantPermission] = useState<SharePermission>('view');
  const [copied, setCopied] = useState(false);
  const [pendingLeaveGrantId, setPendingLeaveGrantId] = useState<string | null>(null);
  const leaveCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (pendingLeaveGrantId === null) return;
    const frame = window.requestAnimationFrame(() => leaveCancelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pendingLeaveGrantId]);

  const {
    data: summary,
    isLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useShareSummary(entityType, entityId);
  const updatePublicMutation = useUpdatePublicPermission();
  const updateInheritanceMutation = useUpdateInheritancePolicy();
  const grantMutation = useGrantEntityAccess();
  const removeGrantMutation = useRemoveGrant();
  const updateGrantPermissionMutation = useUpdateGrantPermission();

  const isOwner = summary?.entity.ownerId === currentUserId;
  const isAdmin = summary?.userPermission === 'admin';
  const canGrant = isOwner || isAdmin;
  const isLimitedSummary = summary?.visibility === 'limited';
  const collaborators = summary?.collaborators ?? [];
  const pendingInvitations = summary?.pendingInvitations ?? [];

  const accessEntries: AccessEntry[] = (summary?.accessSources ?? []).map((source, index) => ({
    key: `${source.kind}:${source.grantId ?? source.folderId ?? source.userId}:${index}`,
    grantId: source.grantId,
    id: source.userId,
    name: source.name ?? source.email ?? 'Unknown user',
    avatarUrl: source.avatarUrl ?? null,
    permission: source.permission,
    effectivePermission: source.effectivePermission,
    isWinning: source.isWinning,
    isManageable: source.isManageable,
    kind: source.kind,
    source: source.kind === 'folder' ? `via ${source.folderName ?? 'shared folder'}` : source.kind,
    isOwner: source.isOwner,
  }));

  const publicUrl = summary?.publicAccess.url
    ? new URL(summary.publicAccess.url, window.location.origin).toString()
    : '';
  const inheritedPublicAccess = summary?.inheritedPublicAccess ?? [];
  const hasPublicAccess =
    summary?.publicAccess.permission !== 'private' || inheritedPublicAccess.length > 0;
  const isRestricted = (summary?.inheritance?.policy ?? 'inherit') === 'restricted';

  const handleCopy = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      if (!identityLifecycle.isActive()) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      showSuccessToast('URL copied');
    } catch {
      if (!identityLifecycle.isActive()) return;
      showErrorToast('Failed to copy URL');
    }
  };

  const handleGrant = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    grantMutation.mutate(
      { entityType, entityId, email: trimmed, permission: grantPermission },
      { onSuccess: () => setEmail('') },
    );
  };

  const handleRemove = (grantId: string) => {
    removeGrantMutation.mutate(grantId);
  };

  const confirmLeave = () => {
    const grantId = pendingLeaveGrantId;
    if (!grantId) return;
    setPendingLeaveGrantId(null);
    if (entityType === 'page') markSelfLeave(entityId);
    removeGrantMutation.mutate(grantId, {
      onError: () => {
        if (entityType === 'page') consumeSelfLeave(entityId);
      },
    });
  };

  const handleToggleRestriction = () => {
    if (!canGrant) return;
    updateInheritanceMutation.mutate({
      entityType,
      entityId,
      policy: isRestricted ? 'inherit' : 'restricted',
    });
  };

  const { refs, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (open) return;
      if (pendingLeaveGrantId !== null) setPendingLeaveGrantId(null);
      else onClose();
    },
  });

  const dismiss = useDismiss(context, { outsidePressEvent: 'mousedown' });
  const { getFloatingProps } = useInteractions([dismiss]);

  const formatSource = (source: string, entry: AccessEntry) => {
    if (entry.isOwner) return 'Owner';
    if (entry.kind === 'direct') return 'Direct Grant';
    if (entry.kind === 'folder') return source;
    return 'Workspace Member';
  };

  const content =
    summaryError && !summary ? (
      <AccessLoadError
        title="Sharing settings couldn't be loaded."
        description="Access has not been removed. Retry to see the current settings."
        onRetry={() => void refetchSummary()}
      />
    ) : (
      <div {...stylex.props(styles.content)}>
        {canGrant && (
          <>
            <InviteAccessForm
              title="Grant Access"
              onSubmit={handleGrant}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <TextBox
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="Enter email"
                rootStyle={accessStyles.emailField}
                inputStyle={accessStyles.emailInput}
                data-testid="share-email-input"
                aria-label="Email address to invite"
              />
              <Dropdown
                value={grantPermission}
                onChange={setGrantPermission}
                ariaLabel="Permission for new collaborator"
                options={[
                  { value: 'view', label: 'View' },
                  { value: 'commenter', label: 'Comment' },
                  { value: 'edit', label: 'Edit' },
                  ...(isOwner ? [{ value: 'admin' as const, label: 'Admin' }] : []),
                ]}
                rootStyle={accessStyles.permissionDropdown}
                triggerStyle={accessStyles.permissionTrigger}
              />
              <button
                type="submit"
                disabled={grantMutation.isPending || !email.trim()}
                data-testid="share-grant-btn"
                {...stylex.props(accessStyles.submitButton)}
              >
                Add
              </button>
            </InviteAccessForm>

            <div {...stylex.props(styles.sectionSpacer)} />
          </>
        )}

        <div {...stylex.props(styles.section)}>
          <AccessSectionHeading
            icon={hasPublicAccess ? <Globe2 size={16} /> : <Lock size={16} />}
            title="Public Access"
          />
          <div data-testid="share-public-access-permissions">
            {isLimitedSummary ? (
              <p {...stylex.props(styles.notice)}>
                Only admins can view or change public access settings.
              </p>
            ) : (
              <ChoiceGroup
                value={summary?.publicAccess.permission ?? 'private'}
                options={permissionOptions}
                disabled={isLoading || !canGrant || updatePublicMutation.isPending}
                onChange={(permission) =>
                  updatePublicMutation.mutate({
                    entityType,
                    entityId,
                    permission,
                  })
                }
                rootStyle={styles.publicPermission}
                ariaLabel="Public access"
              />
            )}
          </div>
          {publicUrl && (
            <div {...stylex.props(accessStyles.fieldBox)}>
              <div {...stylex.props(styles.publicUrlRow)}>
                <div {...stylex.props(styles.publicUrl)} data-share-public-url="">
                  {publicUrl}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  data-testid="share-copy-url-btn"
                  {...stylex.props(styles.copyButton)}
                  title="Copy URL"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}
        </div>

        {canGrant && (
          <div {...stylex.props(styles.restrictionSection)}>
            <AccessSectionHeading icon={<Shield size={16} />} title="Restrict Inherited Access" />
            <div {...stylex.props(styles.restrictionRow)}>
              <p {...stylex.props(styles.restrictionCopy)}>
                When enabled, only people you directly add can access this {entityType}. Inherited
                access won&apos;t work.
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={isRestricted}
                onClick={handleToggleRestriction}
                disabled={updateInheritanceMutation.isPending}
                data-testid="share-restrict-toggle"
                aria-label="Restrict inherited access"
                {...stylex.props(
                  styles.restrictionToggle,
                  isRestricted ? styles.restricted : styles.unrestricted,
                )}
              >
                <span
                  {...stylex.props(
                    styles.restrictionThumb,
                    isRestricted ? styles.thumbOn : styles.thumbOff,
                  )}
                />
              </button>
            </div>
          </div>
        )}

        <div {...stylex.props(styles.sectionSpacer)} />

        <div {...stylex.props(styles.section)}>
          <AccessSectionHeading icon={<UserRound size={16} />} title="People With Access" />

          <AccessTable
            headers={isLimitedSummary ? ['Name', 'Access'] : ['Name', 'Access', 'Source']}
          >
            {isLoading ? (
              <AccessTableMessage>Loading access…</AccessTableMessage>
            ) : isLimitedSummary ? (
              collaborators.length === 0 ? (
                <AccessTableMessage>No one has account access.</AccessTableMessage>
              ) : (
                collaborators.map((collaborator) => {
                  const displayName =
                    collaborator.userId === currentUserId
                      ? 'You'
                      : (collaborator.name ?? 'Unknown user');
                  return (
                    <AccessTableRow key={collaborator.userId} data-share-collaborator-row="">
                      <CollaboratorIdentity
                        name={collaborator.name}
                        avatarUrl={collaborator.avatarUrl}
                        displayName={displayName}
                      />
                      <span {...stylex.props(styles.permissionText)}>
                        {collaborator.isOwner ? 'Owner' : permissionLabel(collaborator.permission)}
                      </span>
                    </AccessTableRow>
                  );
                })
              )
            ) : accessEntries.length === 0 && pendingInvitations.length === 0 ? (
              <AccessTableMessage>No one has access yet.</AccessTableMessage>
            ) : (
              <>
                {accessEntries.map((entry) => {
                  const isCurrentUser = entry.id === currentUserId;
                  const displayName = isCurrentUser ? 'You' : entry.name;
                  const isTargetOwner = entry.isOwner;
                  const isTargetAdmin = entry.permission === 'admin';
                  const canChangePermission =
                    canGrant &&
                    entry.isManageable &&
                    !isTargetOwner &&
                    !(summary?.userPermission === 'admin' && isTargetAdmin);
                  const canSelfRemove = Boolean(
                    isCurrentUser &&
                      !isTargetOwner &&
                      entry.isManageable &&
                      entry.kind === 'direct' &&
                      entry.grantId,
                  );

                  return (
                    <AccessTableRow key={entry.key} data-share-collaborator-row="">
                      <CollaboratorIdentity
                        name={entry.name}
                        avatarUrl={entry.avatarUrl}
                        displayName={displayName}
                      />
                      {entry.isOwner ? (
                        <span {...stylex.props(styles.permissionText)}>Owner</span>
                      ) : entry.grantId && canChangePermission ? (
                        <Dropdown
                          value={entry.permission}
                          options={[
                            { value: 'view', label: 'View' },
                            { value: 'commenter', label: 'Comment' },
                            { value: 'edit', label: 'Edit' },
                            ...(isOwner ? [{ value: 'admin' as const, label: 'Admin' }] : []),
                            { value: 'remove', label: 'Remove' },
                          ]}
                          ariaLabel={`Permission for ${displayName}`}
                          onChange={(permission) => {
                            if (permission === 'remove') {
                              if (canSelfRemove && entry.grantId) {
                                setPendingLeaveGrantId(entry.grantId);
                              } else if (entry.grantId) {
                                handleRemove(entry.grantId);
                              }
                            } else if (entry.grantId) {
                              updateGrantPermissionMutation.mutate({
                                grantId: entry.grantId,
                                permission,
                              });
                            }
                          }}
                          rootStyle={accessStyles.permissionDropdown}
                          triggerStyle={accessStyles.compactPermissionTrigger}
                        />
                      ) : canSelfRemove && entry.grantId ? (
                        <button
                          type="button"
                          onClick={() => setPendingLeaveGrantId(entry.grantId)}
                          {...stylex.props(styles.leaveButton)}
                        >
                          Leave
                        </button>
                      ) : (
                        <span {...stylex.props(styles.permissionText)}>
                          {permissionLabel(entry.permission)}
                        </span>
                      )}
                      <span {...stylex.props(styles.sourceText)}>
                        {formatSource(entry.source, entry)}
                      </span>
                    </AccessTableRow>
                  );
                })}
                {pendingInvitations.map((invitation) => (
                  <PendingInvitationRow
                    key={invitation.id}
                    invitation={invitation}
                    permissionLabel={permissionLabel(invitation.permission)}
                  />
                ))}
              </>
            )}
          </AccessTable>
        </div>
      </div>
    );

  const leaveConfirmation = (
    <div
      {...stylex.props(styles.leaveConfirmation)}
      role="alertdialog"
      aria-labelledby="leave-share-title"
      aria-describedby="leave-share-description"
      data-testid="leave-share-confirmation"
    >
      <h2 id="leave-share-title" {...stylex.props(styles.leaveTitle)}>
        Leave this {entityType}?
      </h2>
      <p id="leave-share-description" {...stylex.props(styles.leaveDescription)}>
        You will lose direct access to this {entityType}. You may retain access if it is shared
        through a folder or workspace.
      </p>
      <div {...stylex.props(styles.leaveActions)}>
        <button
          ref={leaveCancelRef}
          type="button"
          disabled={removeGrantMutation.isPending}
          onClick={() => setPendingLeaveGrantId(null)}
          {...stylex.props(styles.leaveCancel)}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={removeGrantMutation.isPending}
          onClick={confirmLeave}
          {...stylex.props(actionColors.destructive, styles.leaveConfirm)}
        >
          {removeGrantMutation.isPending ? 'Leaving...' : 'Leave'}
        </button>
      </div>
    </div>
  );

  return (
    <FloatingPortal>
      <FloatingOverlay lockScroll className={stylex.props(styles.overlay).className}>
        <FloatingFocusManager
          context={context}
          {...(pendingLeaveGrantId === null ? {} : { initialFocus: leaveCancelRef })}
        >
          <div
            ref={refs.setFloating}
            {...getFloatingProps({
              onClick: (event) => event.stopPropagation(),
              onKeyDown: (event) => event.stopPropagation(),
            })}
            role="dialog"
            aria-label={
              pendingLeaveGrantId === null
                ? `Share ${title || entityType}`
                : `Leave this ${entityType}`
            }
            data-testid="share-dialog"
            {...stylex.props(styles.dialog)}
          >
            {pendingLeaveGrantId !== null ? (
              leaveConfirmation
            ) : (
              <>
                <div {...stylex.props(styles.dialogHeader)}>
                  <div {...stylex.props(styles.dialogHeaderRow)}>
                    <div {...stylex.props(styles.dialogTitleBlock)}>
                      <h2 id="share-dialog-title" {...stylex.props(styles.dialogTitle)}>
                        Share {title || entityType}
                      </h2>
                      <p {...stylex.props(styles.dialogDescription)}>
                        Grant account access or enable public access for this {entityType}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      data-testid="share-close-btn"
                      {...stylex.props(styles.closeButton)}
                      aria-label="Close sharing panel"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div {...stylex.props(styles.dialogBody)}>{content}</div>
              </>
            )}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
