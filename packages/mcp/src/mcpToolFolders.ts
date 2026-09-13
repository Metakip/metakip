import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readAnnotations, registerTool, writeAnnotations } from './mcpToolRegistration';
import { type McpFolderBackend, mcpFolderListSchema, mcpFolderSchema } from './types';

export function registerFolderTools(
  server: McpServer,
  backend: McpFolderBackend,
  canWrite: boolean,
): void {
  registerTool(
    server,
    'list_folders',
    'Use this when you need to browse accessible Metakip folders. Results are cursor-paginated.',
    { cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
    readAnnotations,
    mcpFolderListSchema,
    (input, options) => backend.listFolders(input, options),
  );

  if (!canWrite) return;

  registerTool(
    server,
    'create_folder',
    'Use this when the user asks to create a Metakip folder.',
    { name: z.string().optional(), parentId: z.string().uuid().nullable().optional() },
    writeAnnotations,
    mcpFolderSchema,
    (input, options) => backend.createFolder(input, options),
  );
  registerTool(
    server,
    'update_folder',
    'Use this when the user asks to rename a Metakip folder.',
    { reference: z.string().min(1), name: z.string() },
    writeAnnotations,
    mcpFolderSchema,
    (input, options) => backend.updateFolder(input.reference, input, options),
  );
}
