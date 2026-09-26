import { z } from 'zod';

export const v1UuidSchema = z.uuid();
export const v1PermissionSchema = z.enum(['view', 'edit', 'admin']).nullable();
export const v1CoverSchema = z
  .object({ type: z.string(), value: z.string().nullable() })
  .nullable();
const v1PageParentIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid parentId');

export const v1CreatePageRequestSchema = z
  .object({
    title: z.string({ error: 'title must be a string' }).optional(),
    parentId: v1PageParentIdSchema.nullable().optional(),
    icon: z.string({ error: 'icon must be a string' }).nullable().optional(),
    markdown: z.string({ error: 'markdown must be a string' }).optional(),
  })
  .meta({
    example: {
      title: 'Project notes',
      markdown: '# Project notes\n\nStart writing here.',
    },
  });

export const v1UpdatePageRequestSchema = z
  .object({
    title: z.string({ error: 'title must be a string' }).optional(),
    icon: z.string({ error: 'icon must be a string or null' }).nullable().optional(),
  })
  .refine((request) => request.title !== undefined || request.icon !== undefined, {
    message: 'No supported fields were provided',
  })
  .meta({ example: { title: 'Updated project notes' } });

export const v1PageResponseSchema = z.object({
  id: v1UuidSchema,
  parentId: v1UuidSchema.nullable(),
  title: z.string(),
  icon: z.string().nullable(),
  cover: v1CoverSchema,
  properties: z.record(z.string(), z.unknown()).nullable(),
  ownerId: v1UuidSchema.nullable(),
  permission: v1PermissionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const v1PageListResponseSchema = z.object({
  data: z.array(v1PageResponseSchema),
  nextCursor: z.string().nullable(),
});

export const v1PageResolutionItemSchema = v1PageResponseSchema
  .extend({ folderPath: z.string() })
  .strict();
export const v1PageResolutionResponseSchema = z
  .object({ data: z.array(v1PageResolutionItemSchema) })
  .strict();

export const v1CreateFolderRequestSchema = z
  .object({
    parentId: v1UuidSchema.nullable().optional(),
    name: z.string().optional(),
  })
  .strict()
  .meta({ example: { name: 'Project notes' } });

export const v1UpdateFolderRequestSchema = z
  .union(
    [
      z
        .object({
          name: z.string(),
          parentId: v1UuidSchema.nullable().optional(),
        })
        .strict(),
      z
        .object({
          name: z.string().optional(),
          parentId: v1UuidSchema.nullable(),
        })
        .strict(),
    ],
    {
      error: (issue) => {
        const { input } = issue;
        if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
          return Object.keys(input).length === 0 ? 'No supported fields were provided' : undefined;
        }
        return undefined;
      },
    },
  )
  .meta({ example: { name: 'Archived notes' } });

export const v1FolderResponseSchema = z
  .object({
    id: v1UuidSchema,
    parentId: v1UuidSchema.nullable(),
    name: z.string(),
    icon: z.string().nullable(),
    ownerId: v1UuidSchema.nullable(),
    permission: v1PermissionSchema,
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .strict();

export const v1FolderListResponseSchema = z
  .object({ data: z.array(v1FolderResponseSchema), nextCursor: z.string().nullable() })
  .strict();

export const v1FolderResolutionItemSchema = v1FolderResponseSchema
  .extend({ folderPath: z.string() })
  .strict();
export const v1FolderResolutionResponseSchema = z
  .object({ data: z.array(v1FolderResolutionItemSchema) })
  .strict();

export const v1ParentRequestSchema = z
  .object({ parentId: v1UuidSchema.nullable() })
  .strict()
  .meta({ example: { parentId: null } });

export const v1MarkdownImportRequestSchema = z
  .object({ file: z.file({ error: 'File is required' }) })
  .strict();

export const v1ImageUploadRequestSchema = z
  .object({
    file: z.file({ error: 'File is required' }),
    alt: z.string().max(500).optional(),
  })
  .strict();

export const v1ImageUploadResponseSchema = z
  .object({
    id: v1UuidSchema,
    url: z.string().min(1),
    markdown: z.string().min(1),
    filename: z.string().min(1),
    originalName: z.string().min(1),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
    size: z.number().int().nonnegative(),
  })
  .strict();

export const v1LifecycleEntityResponseSchema = z.object({ id: v1UuidSchema }).strict();
export const v1LifecycleDeletedResponseSchema = z.object({ deleted: z.literal(true) }).strict();
export const v1LifecyclePurgeResponseSchema = v1LifecycleDeletedResponseSchema
  .extend({
    folders: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative(),
  })
  .strict();
export const v1LifecycleFolderCopyResponseSchema = v1LifecycleEntityResponseSchema
  .extend({ skippedRestrictedItems: z.boolean() })
  .strict();
export const v1LifecyclePageTrashItemSchema = z
  .object({
    id: v1UuidSchema,
    title: z.string(),
    icon: z.string().nullable(),
    deletedAt: z.string().nullable(),
  })
  .strict();
export const v1LifecycleFolderTrashItemSchema = z
  .object({
    id: v1UuidSchema,
    name: z.string(),
    icon: z.string().nullable(),
    deletedAt: z.string().nullable(),
  })
  .strict();
export const v1MarkdownImportResponseSchema = z
  .object({
    page: z.object({ id: v1UuidSchema, title: z.string() }).strict(),
    warnings: z.array(
      z
        .object({
          code: z.literal('LOCAL_IMAGES_NOT_IMPORTED'),
          count: z.number().int().positive(),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export const v1VaultImportResponseSchema = z
  .object({
    foldersCreated: z.number(),
    pagesCreated: z.number(),
    imagesUploaded: z.number(),
    backlinksCreated: z.number(),
    errors: z.array(z.string()),
  })
  .strict();

export type V1CreatePageRequest = z.infer<typeof v1CreatePageRequestSchema>;
export type V1UpdatePageRequest = z.infer<typeof v1UpdatePageRequestSchema>;
export type V1PageResponse = z.infer<typeof v1PageResponseSchema>;
export type V1FolderResponse = z.infer<typeof v1FolderResponseSchema>;
export type V1CreateFolderRequest = z.infer<typeof v1CreateFolderRequestSchema>;
export type V1UpdateFolderRequest = z.infer<typeof v1UpdateFolderRequestSchema>;
export type V1ParentRequest = z.infer<typeof v1ParentRequestSchema>;
export type V1ImageUploadResponse = z.infer<typeof v1ImageUploadResponseSchema>;
export type V1LifecycleEntityResponse = z.infer<typeof v1LifecycleEntityResponseSchema>;
export type V1LifecycleDeletedResponse = z.infer<typeof v1LifecycleDeletedResponseSchema>;
export type V1LifecyclePurgeResponse = z.infer<typeof v1LifecyclePurgeResponseSchema>;
export type V1LifecycleFolderCopyResponse = z.infer<typeof v1LifecycleFolderCopyResponseSchema>;
export type V1LifecyclePageTrashItem = z.infer<typeof v1LifecyclePageTrashItemSchema>;
export type V1LifecycleFolderTrashItem = z.infer<typeof v1LifecycleFolderTrashItemSchema>;
export type V1MarkdownImportResponse = z.infer<typeof v1MarkdownImportResponseSchema>;
export type V1VaultImportResponse = z.infer<typeof v1VaultImportResponseSchema>;

export type { V1VaultImportFile, V1VaultImportKind } from './v1Import.js';
export {
  getV1VaultImportKind,
  isCanonicalRelativeV1VaultPath,
  v1VaultImportFileSchema,
  vaultImportRequestSchema,
} from './v1Import.js';
