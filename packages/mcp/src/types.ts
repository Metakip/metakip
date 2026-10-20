import {
  type CommentAnchor,
  type CommentListStatus,
  type CommentThreadStatus,
  type InheritancePolicy,
  MCP_COMMENT_SCOPE,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  type McpContentOperation,
  type McpEmptied,
  type McpExactEdit,
  type McpFolder,
  type McpFolderList,
  type McpImportFolder,
  type McpLifecycleBatch,
  type McpMarkdownImport,
  type McpPage,
  type McpPageList,
  type McpReadPage,
  type McpReplacePage,
  type McpSearch,
  type McpTrashList,
  type McpWhoami,
  type PageCommentThread,
  type PageCommentThreadsResponse,
  type PublicPermission,
  type ShareEntityType,
  type SharePermission,
  type V1ResentShareInvitation,
  type V1ShareGrantResponse,
  type V1ShareInheritance,
  type V1ShareMutation,
  type V1SharePublicAccess,
  type V1SharingSummary,
  type V1WorkspaceMemberAdded,
  type V1WorkspaceSharingSummary,
  type WorkspaceRole,
} from '@metakip/shared';
import type { McpInternalAuthContext } from '@metakip/shared/node/mcp-internal-auth';

export * from '@metakip/shared';

export type McpActor = {
  authContext: McpInternalAuthContext;
  apiInternalSecret: string;
};

export type McpRequestOptions = {
  signal?: AbortSignal | undefined;
};

export type ImportFile = {
  path: string;
  content?: string | undefined;
  data?: string | undefined;
  mimeType?: string | undefined;
};

export type BinaryExport = {
  body: Buffer | string;
  contentType: 'application/zip' | 'text/markdown';
  contentDisposition: string;
  pageId?: string;
  page?: McpPage;
};

export type McpIdentityBackend = {
  whoami(options?: McpRequestOptions): Promise<McpWhoami>;
};

export type McpPageBackend = {
  listPages(
    input: {
      cursor?: string | undefined;
      limit?: number | undefined;
      parentId?: string | undefined;
    },
    options?: McpRequestOptions,
  ): Promise<McpPageList>;
  readPage(reference: string, options?: McpRequestOptions): Promise<McpReadPage>;
  createPage(
    input: {
      title?: string | undefined;
      parentId?: string | null | undefined;
      icon?: string | null | undefined;
      markdown?: string | undefined;
    },
    options?: McpRequestOptions,
  ): Promise<McpPage>;
  updatePage(
    reference: string,
    input: {
      title?: string | undefined;
      icon?: string | null | undefined;
      clearIcon?: boolean | undefined;
    },
    options?: McpRequestOptions,
  ): Promise<McpPage>;
  replacePage(
    reference: string,
    markdown: string,
    options?: McpRequestOptions,
  ): Promise<McpReplacePage>;
  editPageExact(
    reference: string,
    input: {
      oldText: string;
      newText: string;
      editId?: string | undefined;
      idempotencyKey: string;
    },
    options?: McpRequestOptions,
  ): Promise<McpExactEdit>;
  appendToPage(
    reference: string,
    input: {
      content: string;
      editId?: string | undefined;
      idempotencyKey: string;
    },
    options?: McpRequestOptions,
  ): Promise<McpContentOperation>;
  prependToPage(
    reference: string,
    input: {
      content: string;
      editId?: string | undefined;
      idempotencyKey: string;
    },
    options?: McpRequestOptions,
  ): Promise<McpContentOperation>;
};

export type McpSearchBackend = {
  search(query: string, options?: McpRequestOptions): Promise<McpSearch>;
};

export type McpCommentsBackend = {
  listPageComments(
    reference: string,
    input: { status?: CommentListStatus; cursor?: string; limit?: number },
    options?: McpRequestOptions,
  ): Promise<PageCommentThreadsResponse>;
  addPageComment(
    reference: string,
    input: { body: string; anchor: CommentAnchor },
    options?: McpRequestOptions,
  ): Promise<PageCommentThread>;
  replyToComment(
    reference: string,
    threadId: string,
    body: string,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread>;
  editComment(
    reference: string,
    commentId: string,
    body: string,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread>;
  deleteComment(
    reference: string,
    commentId: string,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread>;
  setCommentThreadStatus(
    reference: string,
    threadId: string,
    status: CommentThreadStatus,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread>;
};

export type McpFolderBackend = {
  listFolders(
    input: { cursor?: string | undefined; limit?: number | undefined },
    options?: McpRequestOptions,
  ): Promise<McpFolderList>;
  createFolder(
    input: { name?: string | undefined; parentId?: string | null | undefined },
    options?: McpRequestOptions,
  ): Promise<McpFolder>;
  updateFolder(
    reference: string,
    input: { name?: string | undefined },
    options?: McpRequestOptions,
  ): Promise<McpFolder>;
};

export type McpSharingBackend = {
  getSharingSummary(
    entityType: ShareEntityType,
    reference: string,
    options?: McpRequestOptions,
  ): Promise<V1SharingSummary>;
  grantEntityAccess(
    entityType: ShareEntityType,
    reference: string,
    input: { email: string; permission: SharePermission },
    options?: McpRequestOptions,
  ): Promise<V1ShareGrantResponse>;
  updateSharePermission(
    entityType: ShareEntityType,
    reference: string,
    email: string,
    permission: SharePermission,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation>;
  revokeShare(
    entityType: ShareEntityType,
    reference: string,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation>;
  leaveSharedEntity(
    entityType: ShareEntityType,
    reference: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation>;
  updatePublicAccess(
    entityType: ShareEntityType,
    reference: string,
    permission: PublicPermission | 'private',
    options?: McpRequestOptions,
  ): Promise<V1SharePublicAccess>;
  updateSharingInheritance(
    entityType: ShareEntityType,
    reference: string,
    policy: InheritancePolicy,
    options?: McpRequestOptions,
  ): Promise<V1ShareInheritance>;
  resendSharingInvitation(
    entityType: ShareEntityType,
    reference: string,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ResentShareInvitation>;
  cancelSharingInvitation(
    entityType: ShareEntityType,
    reference: string,
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation>;
  getWorkspaceSharingSummary(options?: McpRequestOptions): Promise<V1WorkspaceSharingSummary>;
  addWorkspaceMember(
    email: string,
    role: WorkspaceRole,
    options?: McpRequestOptions,
  ): Promise<V1WorkspaceMemberAdded>;
  updateWorkspaceMember(
    email: string,
    role: WorkspaceRole,
    options?: McpRequestOptions,
  ): Promise<V1ShareMutation>;
  removeWorkspaceMember(email: string, options?: McpRequestOptions): Promise<V1ShareMutation>;
  leaveWorkspace(ownerId: string, options?: McpRequestOptions): Promise<V1ShareMutation>;
  resendWorkspaceInvitation(
    email: string,
    options?: McpRequestOptions,
  ): Promise<V1ResentShareInvitation>;
  cancelWorkspaceInvitation(email: string, options?: McpRequestOptions): Promise<V1ShareMutation>;
};

export type McpTrashLifecycleBackend = {
  listTrashed(options?: McpRequestOptions): Promise<McpTrashList>;
  movePages(
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch>;
  copyPages(
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch>;
  trashPages(
    references: readonly string[],
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch>;
  moveFolders(
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch>;
  copyFolders(
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch>;
  trashFolders(
    references: readonly string[],
    force: boolean,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch>;
  restoreTrash(
    type: 'page' | 'folder',
    references: readonly string[],
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch>;
  deleteTrash(
    type: 'page' | 'folder',
    references: readonly string[],
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch>;
  emptyTrash(options?: McpRequestOptions): Promise<McpEmptied>;
};

export type McpImportExportBackend = {
  exportPage(reference: string, options?: McpRequestOptions): Promise<BinaryExport>;
  exportAll(options?: McpRequestOptions): Promise<BinaryExport>;
  importPage(
    input: { filename: string; content: string },
    options?: McpRequestOptions,
  ): Promise<McpMarkdownImport>;
  importFolder(
    input: { files: readonly ImportFile[] },
    options?: McpRequestOptions,
  ): Promise<McpImportFolder>;
};

export type McpRequestBackend = McpIdentityBackend &
  McpPageBackend &
  McpSearchBackend &
  McpCommentsBackend &
  McpFolderBackend &
  McpSharingBackend &
  McpTrashLifecycleBackend &
  McpImportExportBackend & {
    readonly canReadPages: boolean;
    readonly canWrite: boolean;
    readonly canReadComments: boolean;
    readonly canWriteComments: boolean;
  };

export class McpBackendError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(message: string, status: number, options: { code?: string; details?: unknown } = {}) {
    super(message);
    this.name = 'McpBackendError';
    this.status = status;
    this.code = options.code;
    this.details = options.details;
  }
}

export { MCP_COMMENT_SCOPE, MCP_READ_SCOPE, MCP_WRITE_SCOPE };
