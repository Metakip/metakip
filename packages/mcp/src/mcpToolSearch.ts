import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { readAnnotations, registerTool } from './mcpToolRegistration';
import type { McpSearchBackend } from './types';
import { mcpSearchSchema } from './types';

export function registerSearchTool(server: McpServer, backend: McpSearchBackend): void {
  registerTool(
    server,
    'search',
    'Search accessible Metakip pages by title and Markdown body, and folders by name. Returns up to 20 mixed page and folder results in relevance order. Use a returned page ID with read_page to inspect Markdown.',
    { query: z.string().trim().min(1) },
    readAnnotations,
    mcpSearchSchema,
    (input, options) => backend.search(input.query, options),
  );
}
