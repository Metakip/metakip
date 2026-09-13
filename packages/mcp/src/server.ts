import { McpServer } from '@modelcontextprotocol/server';
import { registerFolderTools } from './mcpToolFolders';
import { registerImportExportTools } from './mcpToolImportExport';
import { registerPageTools } from './mcpToolPages';
import { readAnnotations, registerTool } from './mcpToolRegistration';
import { registerTrashLifecycleTools } from './mcpToolTrashLifecycle';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE, type McpRequestBackend, mcpWhoamiSchema } from './types';

const MCP_INSTRUCTIONS =
  'Metakip page titles are separate metadata from authored Markdown. When creating or replacing a page, do not add a Markdown H1 that repeats the page title unless the user explicitly requests that H1. For imports, filenames become page titles, so preserve supplied Markdown without adding a duplicate heading.';

export function createMcpServer(backend: McpRequestBackend): McpServer {
  const server = new McpServer(
    { name: 'metakip', version: '0.1.0' },
    { instructions: MCP_INSTRUCTIONS },
  );

  registerTool(
    server,
    'whoami',
    'Use this when you need to identify the connected Metakip account.',
    {},
    readAnnotations,
    mcpWhoamiSchema,
    (_input, options) => backend.whoami(options),
  );

  registerPageTools(server, backend, backend.canWrite);
  registerFolderTools(server, backend, backend.canWrite);
  registerTrashLifecycleTools(server, backend, backend.canWrite);
  registerImportExportTools(server, backend, backend.canWrite);

  return server;
}

export { MCP_READ_SCOPE, MCP_WRITE_SCOPE };
