import type { EditorView } from '@codemirror/view';
import {
  type HocuspocusProvider,
  type onAuthenticationFailedParameters,
  type onCloseParameters,
  WebSocketStatus,
} from '@hocuspocus/provider';
import {
  COLLAB_DOCUMENT_RELOAD_REASONS,
  COLLAB_GUEST_IDENTITY_EXPIRED_REASON,
  COLLAB_TERMINAL_REASONS,
  deriveCapabilities,
  type PageTreeNode,
  type SharePermission,
  shouldApplyPermissionSnapshot,
} from '@markdawn/shared';
import type { QueryClient } from '@tanstack/react-query';
import type * as Y from 'yjs';
import { refreshWikiLinkPresentations } from '../editor/wikiLinkPresentations';
import type { getLogger } from '../logger-init';
import { rotateAnonymousId } from './anonymous-cookie';
import type { CollaborationEventBridge } from './collaborationEventBridge';
import { formatGrantNotification } from './grantNotification';
import { consumeSelfLeave } from './leave-page';
import { showInfoToast } from './toast';
import { buildFolderPath, getWorkspacePath } from './url';

type Logger = ReturnType<typeof getLogger>;
type TerminalCollabEviction = 'access_revoked' | 'page_deleted';
type Navigate = (to: string, options: { replace: boolean }) => void;

type LatestLifecycleOptions = {
  isAnonymous: boolean;
  onDocumentReloadRequired?: () => void;
  onPermissionSnapshot?: (permission: SharePermission | null, accessRevision: string) => void;
  onStatusChange?: (status: WebSocketStatus) => void;
};

export type CollaborationLifecycleControllerOptions = {
  provider: HocuspocusProvider;
  doc: Y.Doc;
  pageId: string;
  editorRef: { current: EditorView | null };
  eventBridge: CollaborationEventBridge;
  isIdentityActive: () => boolean;
  getLatestOptions: () => LatestLifecycleOptions;
  logger: Logger;
  navigate: Navigate;
  queryClient: QueryClient;
  setReadOnly: (readOnly: boolean) => void;
  setAccessPermission: (permission: 'view' | 'edit' | null) => void;
  setCapabilities: (capabilities: ReturnType<typeof deriveCapabilities>) => void;
  invalidateWorkspaceAccess: () => void;
};

function getTerminalCollabEviction(
  event: onCloseParameters['event'],
): TerminalCollabEviction | null {
  if (
    event.code === 4401 ||
    event.reason === COLLAB_TERMINAL_REASONS.ACCESS_REVOKED ||
    event.reason === COLLAB_TERMINAL_REASONS.SESSION_EXPIRED
  ) {
    return 'access_revoked';
  }
  if (event.code === 4402 || event.reason === COLLAB_TERMINAL_REASONS.PAGE_DELETED) {
    return 'page_deleted';
  }
  return null;
}

export class CollaborationLifecycleController {
  private hasEvictedPage = false;
  private hasRequestedDocumentReload = false;
  private latestAccessRevision: bigint | null = null;
  private authoritativePermission: SharePermission | null | undefined;

  constructor(private readonly options: CollaborationLifecycleControllerOptions) {}

  attach(): () => void {
    const { provider, doc, pageId, eventBridge, logger } = this.options;
    provider.on('status', this.handleStatus);
    provider.on('sync', this.handleSync);
    provider.on('persisted', this.handlePersisted);
    provider.on('awareness', this.handleAwareness);
    provider.on('error', this.handleError);
    const unbindBridge = eventBridge.bind({
      onStateless: this.handleStateless,
      onClose: this.handleClose,
      onAuthenticationFailed: this.handleAuthenticationFailed,
    });
    doc.on('update', this.handleDocumentUpdate);
    logger.info`[editor] connecting to collab: ${pageId}`;
    const connectingTimer = window.setTimeout(
      () => this.options.getLatestOptions().onStatusChange?.(WebSocketStatus.Connecting),
      0,
    );

    return () => {
      window.clearTimeout(connectingTimer);
      provider.off('status', this.handleStatus);
      provider.off('sync', this.handleSync);
      provider.off('persisted', this.handlePersisted);
      provider.off('awareness', this.handleAwareness);
      provider.off('error', this.handleError);
      unbindBridge();
      doc.off('update', this.handleDocumentUpdate);
      logger.debug`[editor] disconnected: ${pageId}`;
    };
  }

  private readonly evictPage = (
    reason: TerminalCollabEviction,
    suppressToast: boolean,
    deletedEntityType: 'page' | 'folder' = 'page',
  ): void => {
    const { pageId, queryClient } = this.options;
    if (this.hasEvictedPage || !this.options.isIdentityActive()) return;
    this.hasEvictedPage = true;
    this.authoritativePermission = null;
    this.options.setReadOnly(true);
    this.options.setAccessPermission(null);
    this.options.setCapabilities(deriveCapabilities(null));
    const detail = queryClient.getQueryData<Record<string, unknown>>(['pages', 'detail', pageId]);
    const detailParentId = typeof detail?.parentId === 'string' ? detail.parentId : null;
    const treeParentId = queryClient
      .getQueryData<PageTreeNode[]>(['pageTree'])
      ?.find((page) => page.id === pageId)?.parentId;
    const parentId = detailParentId ?? treeParentId;
    queryClient.removeQueries({ queryKey: ['pages', 'detail', pageId], exact: true });
    this.options.invalidateWorkspaceAccess();
    if (!suppressToast) {
      showInfoToast(
        reason === 'access_revoked'
          ? 'Removed from your view'
          : deletedEntityType === 'folder'
            ? 'Folder deleted'
            : 'Page deleted',
      );
    }
    this.options.navigate(
      suppressToast && parentId ? buildFolderPath('folder', parentId) : getWorkspacePath(),
      {
        replace: true,
      },
    );
  };

  private readonly handleStatus = ({ status }: { status: WebSocketStatus }): void => {
    this.options.logger.debug`[collab] status: ${status}`;
    if (status !== WebSocketStatus.Connected) {
      this.options.setReadOnly(true);
      this.options.setCapabilities(deriveCapabilities(null));
    } else {
      this.refreshWikiLinks();
    }
    this.options.getLatestOptions().onStatusChange?.(status);
  };

  private readonly handleClose = ({ event }: onCloseParameters): void => {
    if (!this.options.isIdentityActive()) return;
    const terminalEviction = getTerminalCollabEviction(event);
    this.options.logger.debug`[collab] closed: code=${event.code} reason=${event.reason}`;
    this.options.setReadOnly(true);
    this.options.setCapabilities(deriveCapabilities(null));
    if (
      event.reason === COLLAB_DOCUMENT_RELOAD_REASONS.CONTENT_REPLACED ||
      event.reason === COLLAB_DOCUMENT_RELOAD_REASONS.RELOAD_REQUIRED
    ) {
      if (!this.hasRequestedDocumentReload) {
        this.hasRequestedDocumentReload = true;
        this.options.getLatestOptions().onDocumentReloadRequired?.();
      }
      return;
    }
    if (terminalEviction !== null) {
      this.evictPage(terminalEviction, consumeSelfLeave(this.options.pageId));
    }
  };

  private readonly handleAuthenticationFailed = ({
    reason,
  }: onAuthenticationFailedParameters): void => {
    if (!this.options.isIdentityActive()) return;
    this.options.logger.debug`[collab] authentication failed: reason=${reason}`;
    if (
      this.options.getLatestOptions().isAnonymous &&
      reason === COLLAB_GUEST_IDENTITY_EXPIRED_REASON
    ) {
      rotateAnonymousId();
      this.options.getLatestOptions().onDocumentReloadRequired?.();
      return;
    }
    this.evictPage('access_revoked', consumeSelfLeave(this.options.pageId));
  };

  private syncPagePermission(permission: SharePermission | null): void {
    const capabilities = deriveCapabilities(permission);
    this.options.queryClient.setQueryData(
      ['pages', 'detail', this.options.pageId],
      (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        return {
          ...old,
          userPermission: permission,
          accessPermission: permission === 'admin' ? 'edit' : permission,
          capabilities,
        };
      },
    );
  }

  private failClosedOnMalformedPermission(reason: string): void {
    this.options.logger.warn`[collab] ${reason}`;
    this.options.setReadOnly(true);
    this.options.setAccessPermission(null);
    this.options.setCapabilities(deriveCapabilities(null));
    this.syncPagePermission(null);
  }

  private readonly handleStateless = ({ payload }: { payload: string }): void => {
    if (!this.options.isIdentityActive()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      this.options.logger
        .warn`[collab] ignored malformed stateless message: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.options.logger.warn`[collab] ignored malformed stateless message: expected an object`;
      return;
    }
    const message = parsed as Record<string, unknown>;

    if (message.type === 'permission_snapshot') {
      this.handlePermissionSnapshot(message);
      return;
    }
    if (message.type === 'permission_changed') {
      this.handleLegacyPermissionChange(message);
      return;
    }
    if (message.type === 'share_event') {
      this.options.logger
        .info`[collab] share event: action=${String(message.action)} permission=${String(message.permission)}`;
      this.invalidateSharingQueries();
      return;
    }
    if (message.type === 'entity_deleted') {
      const entityType = message.entityType as string | undefined;
      this.options.logger
        .info`[collab] entity deleted: entityType=${entityType} entityId=${String(message.entityId)}`;
      this.evictPage(
        'page_deleted',
        consumeSelfLeave(this.options.pageId),
        entityType === 'folder' ? 'folder' : 'page',
      );
      return;
    }
    if (message.type === 'wiki_link_presentations_changed') {
      const targetIds = Array.isArray(message.targetIds)
        ? message.targetIds.filter((targetId): targetId is string => typeof targetId === 'string')
        : undefined;
      this.refreshWikiLinks(targetIds);
      this.options.queryClient.invalidateQueries({ queryKey: ['backlinks'] });
      return;
    }
    if (message.type === 'grant_received') {
      const sharedByName = message.sharedByName as string | undefined;
      const entityTitle = message.entityTitle as string | undefined;
      if (sharedByName && entityTitle) {
        showInfoToast(formatGrantNotification(sharedByName, entityTitle));
      }
      this.options.queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
      this.options.queryClient.invalidateQueries({ queryKey: ['pageTree'] });
      this.options.queryClient.invalidateQueries({ queryKey: ['folderTree'] });
    }
  };

  private handlePermissionSnapshot(message: Record<string, unknown>): void {
    const permission = message.permission;
    const accessRevision = message.accessRevision;
    const validPermission =
      permission === null ||
      permission === 'view' ||
      permission === 'edit' ||
      permission === 'admin';
    if (!validPermission || typeof accessRevision !== 'string' || !/^\d+$/.test(accessRevision)) {
      this.failClosedOnMalformedPermission('rejected malformed permission snapshot');
      return;
    }

    let revision: bigint;
    try {
      revision = BigInt(accessRevision);
    } catch {
      this.failClosedOnMalformedPermission('rejected malformed permission revision');
      return;
    }
    const previousRevision = this.latestAccessRevision;
    const previousPermission = this.authoritativePermission;
    if (
      !shouldApplyPermissionSnapshot(
        previousRevision !== null && previousPermission !== undefined
          ? { permission: previousPermission, accessRevision: previousRevision.toString() }
          : null,
        { permission, accessRevision },
      )
    ) {
      this.options.logger
        .warn`[collab] ignored stale permission snapshot revision=${accessRevision}`;
      return;
    }

    this.latestAccessRevision = revision;
    this.authoritativePermission = permission;
    const isPermissionTransition =
      previousRevision === null || revision > previousRevision || previousPermission !== permission;
    const isSelfLeaveTransition = isPermissionTransition && consumeSelfLeave(this.options.pageId);
    this.options.setReadOnly(permission === null || permission === 'view');
    this.options.setAccessPermission(permission === 'admin' ? 'edit' : permission);
    this.options.setCapabilities(deriveCapabilities(permission));
    this.syncPagePermission(permission);
    this.options.getLatestOptions().onPermissionSnapshot?.(permission, accessRevision);

    if (permission === null) {
      this.evictPage('access_revoked', isSelfLeaveTransition);
    } else if (
      previousRevision !== null &&
      (revision > previousRevision || previousPermission !== permission)
    ) {
      this.options.invalidateWorkspaceAccess();
    }
    if (
      permission === 'view' &&
      previousPermission !== undefined &&
      previousPermission !== 'view'
    ) {
      showInfoToast('This page is now view-only');
    }
  }

  private handleLegacyPermissionChange(message: Record<string, unknown>): void {
    if (this.authoritativePermission !== undefined) return;
    const permission = message.permission as string | undefined;
    const isSelfLeaveTransition = consumeSelfLeave(this.options.pageId);
    this.options.logger.info`[collab] permission changed: ${permission}`;
    if (permission === 'view') {
      this.options.setReadOnly(true);
      this.options.setAccessPermission('view');
      this.options.setCapabilities(deriveCapabilities('view'));
      this.syncPagePermission('view');
      showInfoToast('This page is now view-only');
    } else if (permission === 'edit') {
      this.failClosedOnMalformedPermission('ignored unversioned edit permission');
    } else if (permission === 'private') {
      this.evictPage('access_revoked', isSelfLeaveTransition);
    }
  }

  private invalidateSharingQueries(): void {
    this.options.queryClient.invalidateQueries({ queryKey: ['shared-with-me'] });
    this.options.queryClient.invalidateQueries({ queryKey: ['pageTree'] });
    this.options.queryClient.invalidateQueries({ queryKey: ['folderTree'] });
    this.options.queryClient.invalidateQueries({ queryKey: ['shares'] });
  }

  private refreshWikiLinks(targetIds?: string[]): void {
    try {
      const view = this.options.editorRef.current;
      if (view) refreshWikiLinkPresentations(view, targetIds);
    } catch {
      // The editor may have been destroyed while reconnecting.
    }
  }

  private readonly handleSync = ({
    documentName,
    state,
  }: {
    documentName: string;
    state: Uint8Array;
  }): void => {
    this.options.logger.debug`[collab] synced to server: ${documentName}, ${state.length} bytes`;
  };

  private readonly handlePersisted = ({ documentName }: { documentName: string }): void => {
    this.options.logger.debug`[collab] persisted to db: ${documentName}`;
  };

  private readonly handleAwareness = (args: unknown): void => {
    this.options.logger.debug`[collab] awareness: ${JSON.stringify(args).slice(0, 100)}`;
  };

  private readonly handleError = (args: unknown): void => {
    this.options.logger.error`[collab] error: ${args}`;
  };

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    this.options.logger
      .debug`[collab] doc update: origin=${String(origin)}, bytes=${update.length}`;
  };
}
