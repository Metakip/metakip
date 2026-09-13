import {
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import type { ShareEntityType, SharePermission } from '@metakip/shared';
import { Check, Copy, Globe2, Lock, Mail, Shield, UserRound, X } from 'lucide-react';
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
import { ChoiceGroup, Dropdown, TextBox } from '../ui/FormControls';

type ShareDialogProps = {
  entityType: ShareEntityType;
  entityId: string;
  title: string;
  onClose: () => void;
};

const permissionOptions: Array<{
  value: Exclude<SharePermission, 'admin'> | 'private';
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
    <div className="flex min-w-0 items-center gap-2">
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full"
        style={{ backgroundColor: avatarUrl ? undefined : '#71717a' }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name ?? ''}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="text-[9px] font-bold text-white">
            {getInitial(name ?? 'Unknown user')}
          </span>
        )}
      </div>
      <p className="max-w-[18ch] truncate text-sm text-zinc-900 dark:text-zinc-100">
        {displayName}
      </p>
    </div>
  );
}

function permissionLabel(permission: SharePermission): string {
  if (permission === 'admin') return 'Admin';
  if (permission === 'edit') return 'Edit';
  return 'View';
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
      <div
        role="alert"
        className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/20"
      >
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          Sharing settings couldn&apos;t be loaded.
        </p>
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          Access has not been removed. Retry to see the current settings.
        </p>
        <button
          type="button"
          onClick={() => void refetchSummary()}
          className="mt-3 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40 cursor-pointer"
        >
          Retry
        </button>
      </div>
    ) : (
      <div className="space-y-0">
        {canGrant && (
          <>
            <form
              onSubmit={handleGrant}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className="space-y-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  <Mail size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Grant access
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="grid gap-0 sm:grid-cols-[minmax(0,1fr)_5rem_auto] sm:items-center">
                  <TextBox
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="Enter email"
                    className="h-6"
                    inputClassName="h-6 py-0 text-sm"
                    data-testid="share-email-input"
                    aria-label="Existing user's email address"
                  />
                  <Dropdown
                    value={grantPermission}
                    onChange={setGrantPermission}
                    ariaLabel="Permission for new collaborator"
                    options={[
                      { value: 'view', label: 'View' },
                      { value: 'edit', label: 'Edit' },
                      ...(isOwner ? [{ value: 'admin' as const, label: 'Admin' }] : []),
                    ]}
                    className="w-fit"
                    triggerClassName="px-2"
                  />
                  <button
                    type="submit"
                    disabled={grantMutation.isPending || !email.trim()}
                    data-testid="share-grant-btn"
                    className="inline-flex h-6 items-center justify-center rounded-lg border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 hover:border-zinc-300 disabled:cursor-default disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:hover:border-zinc-700 cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            </form>

            <div className="h-4" />
          </>
        )}

        <div className="space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              {hasPublicAccess ? <Globe2 size={16} /> : <Lock size={16} />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Public access</p>
            </div>
          </div>
          <div data-testid="share-public-access-permissions">
            {isLimitedSummary ? (
              <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
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
                className="w-full justify-between"
                ariaLabel="Public access"
              />
            )}
          </div>
          {publicUrl && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950/40">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[11px] text-zinc-500 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden dark:text-zinc-400">
                  {publicUrl}
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  data-testid="share-copy-url-btn"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 cursor-pointer"
                  title="Copy URL"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}
        </div>

        {canGrant && (
          <div className="mt-4 space-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <Shield size={16} />
              </div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Restrict inherited access
              </p>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950/40">
              <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
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
                className={`relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                  isRestricted ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
                }`}
              >
                <span
                  className={`absolute top-[3px] left-[3px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform ${
                    isRestricted ? 'translate-x-[18px]' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        <div className="h-4" />

        <div className="space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <UserRound size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                People with access
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div
              className={`grid gap-2 border-b border-zinc-200 px-3 py-2 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400 ${
                isLimitedSummary
                  ? 'grid-cols-[minmax(0,1fr)_auto]'
                  : 'grid-cols-[minmax(0,1.2fr)_0.5fr_0.7fr]'
              }`}
            >
              <span>Name</span>
              <span>Access</span>
              {!isLimitedSummary && <span>Source</span>}
            </div>
            {isLoading ? (
              <p className="px-3 py-2.5 text-center text-xs text-zinc-500 dark:text-zinc-400">
                Loading access…
              </p>
            ) : isLimitedSummary ? (
              collaborators.length === 0 ? (
                <p className="px-3 py-2.5 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  No one has account access.
                </p>
              ) : (
                collaborators.map((collaborator) => {
                  const displayName =
                    collaborator.userId === currentUserId
                      ? 'You'
                      : (collaborator.name ?? 'Unknown user');
                  return (
                    <div
                      key={collaborator.userId}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-zinc-200 px-3 py-1.5 last:border-b-0 dark:border-zinc-800"
                    >
                      <CollaboratorIdentity
                        name={collaborator.name}
                        avatarUrl={collaborator.avatarUrl}
                        displayName={displayName}
                      />
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">
                        {collaborator.isOwner ? 'Owner' : permissionLabel(collaborator.permission)}
                      </span>
                    </div>
                  );
                })
              )
            ) : accessEntries.length === 0 ? (
              <p className="px-3 py-2.5 text-center text-xs text-zinc-500 dark:text-zinc-400">
                No one has access yet.
              </p>
            ) : (
              accessEntries.map((entry) => {
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
                  <div
                    key={entry.key}
                    className="grid grid-cols-[minmax(0,1.2fr)_0.5fr_0.7fr] items-center gap-2 border-b border-zinc-200 px-3 py-1.5 last:border-b-0 dark:border-zinc-800"
                  >
                    <CollaboratorIdentity
                      name={entry.name}
                      avatarUrl={entry.avatarUrl}
                      displayName={displayName}
                    />
                    {entry.isOwner ? (
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">Owner</span>
                    ) : entry.grantId && canChangePermission ? (
                      <Dropdown
                        value={entry.permission}
                        options={[
                          { value: 'view', label: 'View' },
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
                        className="w-fit"
                        triggerClassName="px-1.5 text-xs"
                      />
                    ) : canSelfRemove && entry.grantId ? (
                      <button
                        type="button"
                        onClick={() => setPendingLeaveGrantId(entry.grantId)}
                        className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 cursor-pointer"
                      >
                        Leave
                      </button>
                    ) : (
                      <span className="text-xs text-zinc-600 dark:text-zinc-300">
                        {permissionLabel(entry.permission)}
                      </span>
                    )}
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {formatSource(entry.source, entry)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );

  const leaveConfirmation = (
    <div
      className="p-6"
      role="alertdialog"
      aria-labelledby="leave-share-title"
      aria-describedby="leave-share-description"
      data-testid="leave-share-confirmation"
    >
      <h2 id="leave-share-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Leave this {entityType}?
      </h2>
      <p id="leave-share-description" className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        You will lose direct access to this {entityType}. You may retain access if it is shared
        through a folder or workspace.
      </p>
      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          ref={leaveCancelRef}
          type="button"
          disabled={removeGrantMutation.isPending}
          onClick={() => setPendingLeaveGrantId(null)}
          className="px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 cursor-pointer disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={removeGrantMutation.isPending}
          onClick={confirmLeave}
          className="px-4 py-2 text-sm font-medium text-white bg-red-600 dark:bg-red-700 rounded-md hover:bg-red-700 dark:hover:bg-red-800 transition-colors disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
        >
          {removeGrantMutation.isPending ? 'Leaving...' : 'Leave'}
        </button>
      </div>
    </div>
  );

  return (
    <FloatingPortal>
      <FloatingOverlay
        lockScroll
        className="bg-zinc-900/40 backdrop-blur-sm grid place-items-center z-50 px-4"
      >
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
            className="w-full max-w-lg flex max-h-[min(620px,calc(100vh-96px))] flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 animate-scale-in"
          >
            {pendingLeaveGrantId !== null ? (
              leaveConfirmation
            ) : (
              <>
                <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2
                        id="share-dialog-title"
                        className="text-sm font-semibold text-zinc-950 dark:text-zinc-50"
                      >
                        Share {title || entityType}
                      </h2>
                      <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        Grant account access or enable public access for this {entityType}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      data-testid="share-close-btn"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                      aria-label="Close sharing panel"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                <div className="overflow-y-auto px-4 py-3.5">{content}</div>
              </>
            )}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}
