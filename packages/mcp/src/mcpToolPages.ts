import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  destructiveAnnotations,
  readAnnotations,
  registerTool,
  writeAnnotations,
} from './mcpToolRegistration';
import {
  McpBackendError,
  type McpPageBackend,
  mcpContentOperationSchema,
  mcpExactEditSchema,
  mcpPageListSchema,
  mcpPageSchema,
  mcpPageSearchSchema,
  mcpReadPageSchema,
  mcpReplacePageSchema,
} from './types';

export type UpdatePageInput = {
  title?: string | undefined;
  icon?: string | null | undefined;
  clearIcon?: boolean | undefined;
};

export function validateUpdatePageInput(input: UpdatePageInput): void {
  if (input.title === undefined && input.icon === undefined && input.clearIcon !== true) {
    throw new McpBackendError('update_page requires title, icon, or clearIcon: true', 400, {
      code: 'invalid_arguments',
    });
  }
}

export function registerPageTools(
  server: McpServer,
  backend: McpPageBackend,
  canWrite: boolean,
): void {
  registerTool(
    server,
    'list_pages',
    'Use this when you need to browse accessible Metakip pages. Results are cursor-paginated; pass nextCursor to continue. Omit parentId to list pages at any depth; root-only filtering is not available through this tool.',
    {
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      parentId: z.string().uuid().optional(),
    },
    readAnnotations,
    mcpPageListSchema,
    (input, options) => backend.listPages(input, options),
  );
  registerTool(
    server,
    'search_pages',
    'Use this when you need to find accessible Metakip pages by title. Searches titles only, returns up to 20 results in relevance order, and includes each page folder path. Use a returned page ID with read_page to inspect its Markdown.',
    { query: z.string().trim().min(1) },
    readAnnotations,
    mcpPageSearchSchema,
    (input, options) => backend.searchPages(input.query, options),
  );
  registerTool(
    server,
    'read_page',
    'Use this when you need page metadata and authored Markdown. The page title is separate metadata and may not appear as a Markdown H1. Accepts a page UUID or an exact title; ambiguous titles return candidates instead of guessing.',
    { reference: z.string().min(1) },
    readAnnotations,
    mcpReadPageSchema,
    (input, options) => backend.readPage(input.reference, options),
  );

  if (!canWrite) return;

  registerTool(
    server,
    'create_page',
    'Use this when the user asks to create a new Metakip page. The title is separate page metadata; do not repeat it as a Markdown H1 unless the user explicitly requests that H1. This changes stored content.',
    {
      title: z.string().optional(),
      parentId: z.string().uuid().nullable().optional(),
      icon: z.string().nullable().optional(),
      markdown: z.string().optional(),
    },
    writeAnnotations,
    mcpPageSchema,
    (input, options) => backend.createPage(input, options),
  );
  registerTool(
    server,
    'update_page',
    'Use this when the user asks to rename, set an icon on, or clear the icon from a Metakip page.',
    {
      reference: z.string().min(1),
      title: z.string().optional(),
      icon: z.string().nullable().optional(),
      clearIcon: z.boolean().optional(),
    },
    writeAnnotations,
    mcpPageSchema,
    (input, options) => backend.updatePage(input.reference, input, options),
    validateUpdatePageInput,
  );
  registerTool(
    server,
    'replace_page',
    'Use this when the user explicitly asks to replace all Markdown in a page. The page title is separate metadata; do not add a duplicate H1 matching it unless explicitly requested. This overwrites the current page content.',
    { reference: z.string().min(1), markdown: z.string() },
    destructiveAnnotations,
    mcpReplacePageSchema,
    (input, options) => backend.replacePage(input.reference, input.markdown, options),
  );
  registerTool(
    server,
    'edit_page_exact',
    'Use this when the user asks to replace an exact Markdown passage. It is conflict-aware and safe to retry with the same idempotencyKey.',
    {
      reference: z.string().min(1),
      oldText: z.string(),
      newText: z.string(),
      editId: z.string().optional(),
      idempotencyKey: z.string().min(1).max(200),
    },
    writeAnnotations,
    mcpExactEditSchema,
    (input, options) => backend.editPageExact(input.reference, input, options),
  );
  registerTool(
    server,
    'append_to_page',
    'Use this when the user asks to append Markdown to a page. Provide a stable idempotencyKey so a retry cannot append the content twice.',
    {
      reference: z.string().min(1),
      content: z.string().min(1),
      editId: z.string().optional(),
      idempotencyKey: z.string().min(1).max(200),
    },
    writeAnnotations,
    mcpContentOperationSchema,
    (input, options) => backend.appendToPage(input.reference, input, options),
  );
  registerTool(
    server,
    'prepend_to_page',
    'Use this when the user asks to prepend Markdown to a page. Provide a stable idempotencyKey so a retry cannot prepend the content twice.',
    {
      reference: z.string().min(1),
      content: z.string().min(1),
      editId: z.string().optional(),
      idempotencyKey: z.string().min(1).max(200),
    },
    writeAnnotations,
    mcpContentOperationSchema,
    (input, options) => backend.prependToPage(input.reference, input, options),
  );
}
