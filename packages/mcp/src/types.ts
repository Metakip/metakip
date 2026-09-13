import {
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
  type McpPageSearch,
  type McpReadPage,
  type McpReplacePage,
  type McpTrashList,
  type McpWhoami,
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
  searchPages(query: string, options?: McpRequestOptions): Promise<McpPageSearch>;
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
  McpFolderBackend &
  McpTrashLifecycleBackend &
  McpImportExportBackend & {
    readonly canWrite: boolean;
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

export { MCP_READ_SCOPE, MCP_WRITE_SCOPE };
