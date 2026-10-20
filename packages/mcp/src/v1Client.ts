import type {
  InheritancePolicy,
  PublicPermission,
  ShareEntityType,
  SharePermission,
  V1ResentShareInvitation,
  V1ShareGrantResponse,
  V1ShareInheritance,
  V1ShareMutation,
  V1SharePublicAccess,
  V1SharingSummary,
  V1WorkspaceMemberAdded,
  V1WorkspaceSharingSummary,
  WorkspaceRole,
} from '@metakip/shared';
import { hasMcpScope } from '@metakip/shared';
import type {
  CommentAnchor,
  CommentListStatus,
  CommentThreadStatus,
  McpContentOperation,
  McpEmptied,
  McpExactEdit,
  McpFolder,
  McpFolderList,
  McpImportFolder,
  McpLifecycleBatch,
  McpMarkdownImport,
  McpPage,
  McpPageList,
  McpReadPage,
  McpReplacePage,
  McpSearch,
  McpTrashList,
  PageCommentThread,
  PageCommentThreadsResponse,
} from './types';
import {
  type BinaryExport,
  type ImportFile,
  MCP_COMMENT_SCOPE,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  type McpActor,
  type McpRequestBackend,
  type McpRequestOptions,
  type McpWhoami,
  mcpIdentitySchema,
  mcpWhoamiSchema,
} from './types';
import { V1CommentClient } from './v1ClientComments';
import { V1FolderClient } from './v1ClientFolders';
import { V1ImportExportClient } from './v1ClientImportExport';
import { V1LifecycleClient } from './v1ClientLifecycle';
import { V1PageClient } from './v1ClientPages';
import { parseApiResponse } from './v1ClientResponse';
import { V1SearchClient } from './v1ClientSearch';
import { V1SharingClient } from './v1ClientSharing';
import {
  type V1ClientIO,
  V1ClientTransport,
  type V1ClientTransportOptions,
} from './v1ClientTransport';
import { V1TrashClient } from './v1ClientTrash';

export type V1ClientOptions = V1ClientTransportOptions & {
  actor: McpActor;
};

export class V1Client extends V1ClientTransport implements McpRequestBackend {
  readonly canReadPages: boolean;
  readonly canWrite: boolean;
  readonly canReadComments: boolean;
  readonly canWriteComments: boolean;
  private readonly actor: McpActor;
  private readonly io: V1ClientIO;
  private readonly pages: V1PageClient;
  private readonly searchClient: V1SearchClient;
  private readonly comments: V1CommentClient;
  private readonly folders: V1FolderClient;
  private readonly trash: V1TrashClient;
  private readonly lifecycle: V1LifecycleClient;
  private readonly importExport: V1ImportExportClient;
  private readonly sharing: V1SharingClient;

  constructor(options: V1ClientOptions) {
    super(options);
    this.actor = options.actor;
    this.canReadPages = hasMcpScope(options.actor.authContext.scopes, MCP_READ_SCOPE);
    this.canWrite = hasMcpScope(options.actor.authContext.scopes, MCP_WRITE_SCOPE);
    this.canReadComments = hasMcpScope(options.actor.authContext.scopes, MCP_COMMENT_SCOPE);
    this.canWriteComments = hasMcpScope(options.actor.authContext.scopes, MCP_COMMENT_SCOPE);
    this.io = {
      send: (actor, path, requestOptions, signal) => this.send(actor, path, requestOptions, signal),
      readJson: (response) => this.readJson(response),
      readMutationJson: (response, parse) => this.readMutationJson(response, parse),
      readBytes: (response, signal) => this.readBytes(response, signal),
      readBinaryOrMarkdown: (response, contentType, signal) =>
        this.readBinaryOrMarkdown(response, contentType, signal),
      discardResponse: (response) => this.discardResponse(response),
    };
    this.pages = new V1PageClient(this.io);
    this.searchClient = new V1SearchClient(this.io);
    this.comments = new V1CommentClient(this.io);
    this.folders = new V1FolderClient(this.io);
    this.trash = new V1TrashClient(this.io);
    this.lifecycle = new V1LifecycleClient(
      this.io,
      (actor, reference, signal) => this.pages.resolvePage(actor, reference, signal),
      (actor, reference, signal) => this.folders.resolveFolder(actor, reference, signal),
      this.trash,
    );
    this.importExport = new V1ImportExportClient(this.io, (actor, reference, signal) =>
      this.pages.resolvePage(actor, reference, signal),
    );
    this.sharing = new V1SharingClient(
      this.io,
      (actor, reference, signal) => this.pages.resolvePage(actor, reference, signal),
      (actor, reference, signal) => this.folders.resolveFolder(actor, reference, signal),
    );
  }

  async whoami(options?: McpRequestOptions): Promise<McpWhoami> {
    const body = parseApiResponse(
      mcpIdentitySchema,
      await this.readJson(await this.send(this.actor, '/me', {}, options?.signal)),
    );
    return parseApiResponse(mcpWhoamiSchema, {
      id: body.id,
      name: body.name,
      email: body.email,
      image: body.image,
      authentication: 'oauth',
      scopes: [...this.actor.authContext.scopes],
    });
  }

  async listPages(
    input: { cursor?: string; limit?: number; parentId?: string },
    options?: McpRequestOptions,
  ): Promise<McpPageList> {
    return this.pages.listPages(this.actor, input, options);
  }

  async search(query: string, options?: McpRequestOptions): Promise<McpSearch> {
    return this.searchClient.search(this.actor, query, options);
  }

  async readPage(reference: string, options?: McpRequestOptions): Promise<McpReadPage> {
    return this.pages.readPage(this.actor, reference, options);
  }

  async listPageComments(
    reference: string,
    input: { status?: CommentListStatus; cursor?: string; limit?: number },
    options?: McpRequestOptions,
  ): Promise<PageCommentThreadsResponse> {
    return this.comments.listPageComments(this.actor, reference, input, options);
  }

  async addPageComment(
    reference: string,
    input: { body: string; anchor: CommentAnchor },
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.comments.addPageComment(this.actor, reference, input, options);
  }

  async replyToComment(
    reference: string,
    threadId: string,
    body: string,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.comments.replyToComment(this.actor, reference, threadId, body, options);
  }

  async editComment(
    reference: string,
    commentId: string,
    body: string,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.comments.editComment(this.actor, reference, commentId, body, options);
  }

  async deleteComment(
    reference: string,
    commentId: string,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.comments.deleteComment(this.actor, reference, commentId, options);
  }

  async setCommentThreadStatus(
    reference: string,
    threadId: string,
    status: CommentThreadStatus,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.comments.setCommentThreadStatus(this.actor, reference, threadId, status, options);
  }

  async listFolders(
    input: { cursor?: string; limit?: number },
    options?: McpRequestOptions,
  ): Promise<McpFolderList> {
    return this.folders.listFolders(this.actor, input, options);
  }

  async listTrashed(options?: McpRequestOptions): Promise<McpTrashList> {
    return this.trash.listTrashed(this.actor, options);
  }

  async exportPage(reference: string, options?: McpRequestOptions): Promise<BinaryExport> {
    return this.importExport.exportPage(this.actor, reference, options);
  }

  async exportAll(options?: McpRequestOptions): Promise<BinaryExport> {
    return this.importExport.exportAll(this.actor, options);
  }

  async createPage(
    input: { title?: string; parentId?: string | null; icon?: string | null; markdown?: string },
    options?: McpRequestOptions,
  ): Promise<McpPage> {
    return this.pages.createPage(this.actor, input, options);
  }

  async updatePage(
    reference: string,
    input: { title?: string; icon?: string | null; clearIcon?: boolean },
    options?: McpRequestOptions,
  ): Promise<McpPage> {
    return this.pages.updatePage(this.actor, reference, input, options);
  }

  async replacePage(
    reference: string,
    markdown: string,
    options?: McpRequestOptions,
  ): Promise<McpReplacePage> {
    return this.pages.replacePage(this.actor, reference, markdown, options);
  }

  async editPageExact(
    reference: string,
    input: { oldText: string; newText: string; editId?: string; idempotencyKey: string },
    options?: McpRequestOptions,
  ): Promise<McpExactEdit> {
    return this.pages.editPageExact(this.actor, reference, input, options);
  }

  async appendToPage(
    reference: string,
    input: { content: string; editId?: string; idempotencyKey: string },
    options?: McpRequestOptions,
  ): Promise<McpContentOperation> {
    return this.pages.appendToPage(this.actor, reference, input, options);
  }

  async prependToPage(
    reference: string,
    input: { content: string; editId?: string; idempotencyKey: string },
    options?: McpRequestOptions,
  ): Promise<McpContentOperation> {
    return this.pages.prependToPage(this.actor, reference, input, options);
  }

  async movePages(
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycle.movePages(this.actor, references, parentId, options);
  }

  async copyPages(
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycle.copyPages(this.actor, references, parentId, options);
  }

  async trashPages(
    references: readonly string[],
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycle.trashPages(this.actor, references, options);
  }

  async createFolder(
    input: { name?: string; parentId?: string | null },
    options?: McpRequestOptions,
  ): Promise<McpFolder> {
    return this.folders.createFolder(this.actor, input, options);
  }

  async updateFolder(
    reference: string,
    input: { name?: string },
    options?: McpRequestOptions,
  ): Promise<McpFolder> {
    return this.folders.updateFolder(this.actor, reference, input, options);
  }

  async moveFolders(
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycle.moveFolders(this.actor, references, parentId, options);
  }

  async copyFolders(
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycle.copyFolders(this.actor, references, parentId, options);
  }

  async trashFolders(
    references: readonly string[],
    force: boolean,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycle.trashFolders(this.actor, references, force, options);
  }

  async restoreTrash(
    type: 'page' | 'folder',
    references: readonly string[],
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycle.restoreTrash(this.actor, type, references, options);
  }

  async deleteTrash(
    type: 'page' | 'folder',
    references: readonly string[],
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycle.deleteTrash(this.actor, type, references, options);
  }

  async emptyTrash(options?: McpRequestOptions): Promise<McpEmptied> {
    return this.trash.emptyTrash(this.actor, options);
  }

  async importPage(
    input: { filename: string; content: string },
    options?: McpRequestOptions,
  ): Promise<McpMarkdownImport> {
    return this.importExport.importPage(this.actor, input, options);
  }

  async importFolder(
    input: { files: readonly ImportFile[] },
    options?: McpRequestOptions,
  ): Promise<McpImportFolder> {
    return this.importExport.importFolder(this.actor, input, options);
  }

  async getSharingSummary(
    entityType: ShareEntityType,
    reference: string,
    options?: McpRequestOptions,
  ): Promise<V1SharingSummary> {
    return this.sharing.getSharingSummary(this.actor, entityType, reference, options);
  }

  async grantEntityAccess(
    entityType: ShareEntityType,
    reference: string,
    input: { email: string; permission: SharePermission },
    options?: McpRequestOptions,
  ): Promise<V1ShareGrantResponse> {
    return this.sharing.grantEntityAccess(this.actor, entityType, reference, input, options);
  }

  async updateSharePermission(
    entityType: ShareEntityType,
    reference: string,
    email: string,
    permission: SharePermission,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.sharing.updateSharePermission(
      this.actor,
      entityType,
      reference,
      email,
      permission,
      options,
    );
  }

  async revokeShare(
    entityType: ShareEntityType,
    reference: string,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.sharing.revokeShare(this.actor, entityType, reference, email, options);
  }

  async leaveSharedEntity(
    entityType: ShareEntityType,
    reference: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.sharing.leaveSharedEntity(this.actor, entityType, reference, options);
  }

  async updatePublicAccess(
    entityType: ShareEntityType,
    reference: string,
    permission: PublicPermission | 'private',
    options?: McpRequestOptions,
  ): Promise<V1SharePublicAccess> {
    return this.sharing.updatePublicAccess(this.actor, entityType, reference, permission, options);
  }

  async updateSharingInheritance(
    entityType: ShareEntityType,
    reference: string,
    policy: InheritancePolicy,
    options?: McpRequestOptions,
  ): Promise<V1ShareInheritance> {
    return this.sharing.updateSharingInheritance(
      this.actor,
      entityType,
      reference,
      policy,
      options,
    );
  }

  async resendSharingInvitation(
    entityType: ShareEntityType,
    reference: string,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ResentShareInvitation> {
    return this.sharing.resendSharingInvitation(this.actor, entityType, reference, email, options);
  }

  async cancelSharingInvitation(
    entityType: ShareEntityType,
    reference: string,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.sharing.cancelSharingInvitation(this.actor, entityType, reference, email, options);
  }

  async getWorkspaceSharingSummary(
    options?: McpRequestOptions,
  ): Promise<V1WorkspaceSharingSummary> {
    return this.sharing.getWorkspaceSharingSummary(this.actor, options);
  }

  async addWorkspaceMember(
    email: string,
    role: WorkspaceRole,
    options?: McpRequestOptions,
  ): Promise<V1WorkspaceMemberAdded> {
    return this.sharing.addWorkspaceMember(this.actor, email, role, options);
  }

  async updateWorkspaceMember(
    email: string,
    role: WorkspaceRole,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.sharing.updateWorkspaceMember(this.actor, email, role, options);
  }

  async removeWorkspaceMember(
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.sharing.removeWorkspaceMember(this.actor, email, options);
  }

  async leaveWorkspace(ownerId: string, options?: McpRequestOptions): Promise<V1ShareMutation> {
    return this.sharing.leaveWorkspace(this.actor, ownerId, options);
  }

  async resendWorkspaceInvitation(
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ResentShareInvitation> {
    return this.sharing.resendWorkspaceInvitation(this.actor, email, options);
  }

  async cancelWorkspaceInvitation(
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation> {
    return this.sharing.cancelWorkspaceInvitation(this.actor, email, options);
  }
}
