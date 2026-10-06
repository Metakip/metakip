import { z } from 'zod';
import { hasApiTokenScope } from '../utils/apiToken.js';
import {
  v1FolderListResponseSchema,
  v1FolderResolutionResponseSchema,
  v1FolderResponseSchema,
  v1MarkdownImportResponseSchema,
  v1PageListResponseSchema,
  v1PageResolutionResponseSchema,
  v1PageResponseSchema,
  v1UuidSchema,
  v1VaultImportResponseSchema,
} from './v1.js';

export const MCP_READ_SCOPE = 'pages:read' as const;
export const MCP_COMMENT_SCOPE = 'pages:comment' as const;
export const MCP_WRITE_SCOPE = 'pages:write' as const;
export type McpScope = typeof MCP_READ_SCOPE | typeof MCP_COMMENT_SCOPE | typeof MCP_WRITE_SCOPE;

export function hasMcpScope(scopes: Iterable<string>, requiredScope: McpScope): boolean {
  return hasApiTokenScope(scopes, requiredScope);
}

const mcpIdSchema = z.string().min(1);
const mcpEntityIdSchema = v1UuidSchema;
export const mcpPageSchema = z
  .object({
    ...v1PageResponseSchema.shape,
    deletedAt: z.string().nullable().optional(),
    folderPath: z.string().optional(),
  })
  .strict();
export type McpPage = z.infer<typeof mcpPageSchema>;

export const mcpFolderSchema = v1FolderResponseSchema
  .extend({ path: z.string().optional() })
  .strict();
export type McpFolder = z.infer<typeof mcpFolderSchema>;

export const mcpPageListSchema = z
  .object(v1PageListResponseSchema.shape)
  .extend({ data: z.array(mcpPageSchema) })
  .strict();
export type McpPageList = z.infer<typeof mcpPageListSchema>;

export const mcpPageResolutionSchema = z
  .object(v1PageResolutionResponseSchema.shape)
  .extend({ data: z.array(mcpPageSchema.extend({ folderPath: z.string() })) })
  .strict();
export const mcpPageSearchSchema = mcpPageResolutionSchema;
export type McpPageSearch = z.infer<typeof mcpPageSearchSchema>;

export const mcpFolderListSchema = z
  .object(v1FolderListResponseSchema.shape)
  .extend({ data: z.array(mcpFolderSchema) })
  .strict();
export type McpFolderList = z.infer<typeof mcpFolderListSchema>;

export const mcpFolderResolutionSchema = z
  .object(v1FolderResolutionResponseSchema.shape)
  .extend({
    data: z.array(mcpFolderSchema.omit({ path: true }).extend({ folderPath: z.string() })),
  })
  .strict();

export const mcpReadPageSchema = z
  .object({ page: mcpPageSchema, markdown: z.string(), etag: z.string().min(1) })
  .strict();
export type McpReadPage = z.infer<typeof mcpReadPageSchema>;

export const mcpIdentitySchema = z
  .object({
    id: mcpEntityIdSchema,
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    authentication: z.enum(['mcp', 'oauth', 'token']),
    scopes: z.array(z.enum([MCP_READ_SCOPE, MCP_COMMENT_SCOPE, MCP_WRITE_SCOPE])),
  })
  .strict();

export const mcpWhoamiSchema = mcpIdentitySchema
  .extend({ authentication: z.literal('oauth') })
  .strict();
export type McpWhoami = z.infer<typeof mcpWhoamiSchema>;

export const mcpTrashItemSchema = z
  .object({
    id: mcpEntityIdSchema,
    type: z.enum(['page', 'folder']),
    title: z.string(),
    icon: z.string().nullable(),
    deletedAt: z.string().nullable(),
  })
  .strict();
export type McpTrashItem = z.infer<typeof mcpTrashItemSchema>;

export const mcpPageTrashResponseSchema = z
  .object({
    id: mcpEntityIdSchema,
    title: z.string(),
    icon: z.string().nullable(),
    deletedAt: z.string().nullable(),
  })
  .strict();

export const mcpFolderTrashResponseSchema = z
  .object({
    id: mcpEntityIdSchema,
    name: z.string(),
    icon: z.string().nullable(),
    deletedAt: z.string().nullable(),
  })
  .strict();
export const mcpTrashItemsSchema = z.array(mcpTrashItemSchema);
export const mcpTrashListSchema = z.object({ items: mcpTrashItemsSchema }).strict();
export type McpTrashList = z.infer<typeof mcpTrashListSchema>;

const mcpLifecycleItemSchema = z
  .object({
    reference: z.string(),
    id: mcpEntityIdSchema.optional(),
    sourceId: mcpEntityIdSchema.optional(),
    status: z.enum(['success', 'failed', 'outcome_uncertain']),
    code: z.string().min(1).optional(),
    message: z.string().optional(),
    skippedRestrictedItems: z.boolean().optional(),
  })
  .strict();

export const mcpLifecycleBatchSchema = z
  .object({ items: z.array(mcpLifecycleItemSchema).max(100) })
  .strict();
export type McpLifecycleBatch = z.infer<typeof mcpLifecycleBatchSchema>;

export const mcpReplacePageSchema = z
  .object({ page: mcpPageSchema, changed: z.boolean(), etag: z.string().min(1) })
  .strict();
export type McpReplacePage = z.infer<typeof mcpReplacePageSchema>;

export const mcpExactEditSchema = z
  .object({
    results: z.array(
      z.discriminatedUnion('status', [
        z.object({ id: mcpIdSchema, status: z.literal('applied') }).strict(),
        z.object({ id: mcpIdSchema, status: z.literal('conflict'), reason: z.string() }).strict(),
        z.object({ id: mcpIdSchema, status: z.literal('invalid'), reason: z.string() }).strict(),
      ]),
    ),
    etag: z.string().min(1),
  })
  .strict();
export type McpExactEdit = z.infer<typeof mcpExactEditSchema>;

export const mcpContentOperationSchema = z
  .object({ id: mcpIdSchema, etag: z.string().min(1) })
  .strict();
export type McpContentOperation = z.infer<typeof mcpContentOperationSchema>;

export const mcpEmptiedSchema = z.object({ emptied: z.literal(true) }).strict();
export type McpEmptied = z.infer<typeof mcpEmptiedSchema>;

export const mcpMarkdownImportSchema = v1MarkdownImportResponseSchema;
export type McpMarkdownImport = z.infer<typeof mcpMarkdownImportSchema>;

export const mcpVaultImportSchema = v1VaultImportResponseSchema;
export type McpVaultImport = z.infer<typeof mcpVaultImportSchema>;

export const mcpImportFolderSchema = z
  .object({
    preview: z
      .object({
        notes: z.number().int().nonnegative(),
        images: z.number().int().nonnegative(),
        folders: z.number().int().nonnegative(),
      })
      .strict(),
    result: mcpVaultImportSchema,
  })
  .strict();
export type McpImportFolder = z.infer<typeof mcpImportFolderSchema>;

export const mcpExportResultSchema = z
  .object({
    pageId: mcpEntityIdSchema.optional(),
    page: mcpPageSchema.optional(),
    format: z.enum(['markdown', 'zip']),
    bytes: z.number().int().nonnegative(),
    contentDisposition: z.string(),
    content: z.string().optional(),
  })
  .strict();
export type McpExportResult = z.infer<typeof mcpExportResultSchema>;
