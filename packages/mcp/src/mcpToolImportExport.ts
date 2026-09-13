import { v1VaultImportFileSchema, vaultImportRequestSchema } from '@metakip/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { registerExportTool, registerTool, writeAnnotations } from './mcpToolRegistration';
import {
  McpBackendError,
  type McpImportExportBackend,
  mcpExportResultSchema,
  mcpImportFolderSchema,
  mcpMarkdownImportSchema,
} from './types';

export function registerImportExportTools(
  server: McpServer,
  backend: McpImportExportBackend,
  canWrite: boolean,
): void {
  registerExportTool(
    server,
    'export_page',
    'Use this when you need to export one accessible page as Markdown or an archive containing its attachments.',
    { reference: z.string().min(1) },
    mcpExportResultSchema,
    (input, options) => backend.exportPage(input.reference, options),
  );
  registerExportTool(
    server,
    'export_all',
    'Use this when you need an archive of all accessible Metakip pages and attachments.',
    {},
    mcpExportResultSchema,
    (_input, options) => backend.exportAll(options),
  );

  if (!canWrite) return;

  registerTool(
    server,
    'import_page',
    'Use this when the user provides Markdown content and asks to import it as a Metakip page. The filename becomes the page title metadata; do not add a duplicate H1 matching the filename unless explicitly requested. This does not access the client filesystem.',
    { filename: z.string().min(1), content: z.string() },
    writeAnnotations,
    mcpMarkdownImportSchema,
    (input, options) => backend.importPage(input, options),
  );
  registerTool(
    server,
    'import_folder',
    'Use this when the user provides a list of Markdown and supported image files and asks to import them as a folder or Obsidian vault. File names become page metadata; preserve supplied Markdown without adding duplicate title H1s. File data is passed explicitly; no client filesystem is accessed.',
    {
      files: z.array(v1VaultImportFileSchema).min(1),
    },
    writeAnnotations,
    mcpImportFolderSchema,
    (input, options) => backend.importFolder(input, options),
    (input) => {
      const parsed = vaultImportRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw new McpBackendError('Invalid import folder files', 400, {
          code: 'invalid_arguments',
          details: parsed.error.issues,
        });
      }
    },
  );
}
