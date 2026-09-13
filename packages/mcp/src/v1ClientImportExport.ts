import { getV1VaultImportKind } from '@metakip/shared';
import {
  type BinaryExport,
  type ImportFile,
  type McpActor,
  type McpImportFolder,
  type McpMarkdownImport,
  type McpRequestOptions,
  mcpImportFolderSchema,
  mcpMarkdownImportSchema,
  mcpVaultImportSchema,
} from './types';
import { folderPathFromFiles, type PageReference, parseApiResponse } from './v1ClientResponse';
import type { V1ClientIO } from './v1ClientTransport';

export function importFolderPreview(files: readonly ImportFile[]): McpImportFolder['preview'] {
  const importableFiles = files.filter((file) => {
    const kind = getV1VaultImportKind(file.path);
    return kind === 'markdown' || kind === 'image';
  });
  return {
    notes: importableFiles.filter((file) => getV1VaultImportKind(file.path) === 'markdown').length,
    images: importableFiles.filter((file) => getV1VaultImportKind(file.path) === 'image').length,
    folders: folderPathFromFiles(importableFiles),
  };
}

export type PageResolver = (
  actor: McpActor,
  reference: string,
  signal?: AbortSignal,
) => Promise<PageReference>;

export class V1ImportExportClient {
  constructor(
    private readonly io: V1ClientIO,
    private readonly resolvePage: PageResolver,
  ) {}

  async exportPage(
    actor: McpActor,
    reference: string,
    options?: McpRequestOptions,
  ): Promise<BinaryExport> {
    const resolved = await this.resolvePage(actor, reference, options?.signal);
    const response = await this.io.send(
      actor,
      `/pages/${resolved.id}/export/markdown`,
      {},
      options?.signal,
    );
    const contentType = response.headers.get('content-type') ?? 'application/zip';
    const contentDisposition =
      response.headers.get('content-disposition') ?? 'attachment; filename="metakip-export"';
    const body = await this.io.readBinaryOrMarkdown(response, contentType, options?.signal);
    return {
      body,
      contentType: contentType.toLowerCase().startsWith('text/markdown')
        ? 'text/markdown'
        : 'application/zip',
      contentDisposition,
      pageId: resolved.id,
      page: resolved.page,
    };
  }

  async exportAll(actor: McpActor, options?: McpRequestOptions): Promise<BinaryExport> {
    const response = await this.io.send(actor, '/exports/workspace', {}, options?.signal);
    return {
      body: await this.io.readBytes(response, options?.signal),
      contentType: 'application/zip',
      contentDisposition:
        response.headers.get('content-disposition') ?? 'attachment; filename="metakip-export.zip"',
    };
  }

  async importPage(
    actor: McpActor,
    input: { filename: string; content: string },
    options?: McpRequestOptions,
  ): Promise<McpMarkdownImport> {
    const form = new FormData();
    form.append('file', new Blob([input.content], { type: 'text/markdown' }), input.filename);
    return this.io.readMutationJson(
      await this.io.send(
        actor,
        '/imports/markdown',
        { method: 'POST', body: form },
        options?.signal,
      ),
      (value) => parseApiResponse(mcpMarkdownImportSchema, value),
    );
  }

  async importFolder(
    actor: McpActor,
    input: { files: readonly ImportFile[] },
    options?: McpRequestOptions,
  ): Promise<McpImportFolder> {
    const files = [...input.files];
    const preview = importFolderPreview(files);
    const result = await this.io.readMutationJson(
      await this.io.send(
        actor,
        '/imports/obsidian',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files }),
        },
        options?.signal,
      ),
      (value) => parseApiResponse(mcpVaultImportSchema, value),
    );
    return parseApiResponse(mcpImportFolderSchema, { preview, result });
  }
}
