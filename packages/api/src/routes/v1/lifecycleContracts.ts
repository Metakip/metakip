import {
  v1LifecycleDeletedResponseSchema,
  v1LifecycleEntityResponseSchema,
  v1LifecycleFolderCopyResponseSchema,
  v1LifecycleFolderTrashItemSchema,
  v1LifecyclePageTrashItemSchema,
  v1LifecyclePurgeResponseSchema,
  v1MarkdownImportRequestSchema,
  v1MarkdownImportResponseSchema,
  v1ParentRequestSchema,
  v1VaultImportResponseSchema,
} from '@metakip/shared';
import { z } from 'zod';
import { vaultImportRequestSchema } from '../../utils/vaultImportValidation';
import {
  binaryResponseSchema,
  jsonContent,
  markdownContent,
  multipartContent,
  uuidPathParameter,
  type V1OperationContract,
  zipContent,
} from './apiContract';
import { lifecyclePaths } from './lifecyclePaths';

export const parentRequestSchema = v1ParentRequestSchema;
export const markdownImportRequestSchema = v1MarkdownImportRequestSchema;
export const lifecycleEntityResponseSchema = v1LifecycleEntityResponseSchema;
export const lifecycleDeletedResponseSchema = v1LifecycleDeletedResponseSchema;
export const lifecyclePurgeResponseSchema = v1LifecyclePurgeResponseSchema;
export const lifecycleFolderCopyResponseSchema = v1LifecycleFolderCopyResponseSchema;
export const lifecyclePageTrashItemSchema = v1LifecyclePageTrashItemSchema;
export const lifecycleFolderTrashItemSchema = v1LifecycleFolderTrashItemSchema;
export const obsidianImportRequestSchema = vaultImportRequestSchema;
export const lifecycleMarkdownImportResponseSchema = v1MarkdownImportResponseSchema;
export const lifecycleVaultImportResponseSchema = v1VaultImportResponseSchema;

export type LifecycleEntityResponse = z.infer<typeof lifecycleEntityResponseSchema>;
export type LifecycleDeletedResponse = z.infer<typeof lifecycleDeletedResponseSchema>;
export type LifecyclePurgeResponse = z.infer<typeof lifecyclePurgeResponseSchema>;
export type LifecycleFolderCopyResponse = z.infer<typeof lifecycleFolderCopyResponseSchema>;
export type LifecyclePageTrashItem = z.infer<typeof lifecyclePageTrashItemSchema>;
export type LifecycleFolderTrashItem = z.infer<typeof lifecycleFolderTrashItemSchema>;
export type LifecycleMarkdownImportResponse = z.infer<typeof lifecycleMarkdownImportResponseSchema>;
export type LifecycleVaultImportResponse = z.infer<typeof lifecycleVaultImportResponseSchema>;

export function toLifecycleEntityResponse(value: { id: string }): LifecycleEntityResponse {
  return { id: value.id };
}

export function toLifecycleDeletedResponse(): LifecycleDeletedResponse {
  return { deleted: true };
}

export function toLifecyclePurgeResponse(value: {
  folders: number;
  pages: number;
}): LifecyclePurgeResponse {
  return { deleted: true, folders: value.folders, pages: value.pages };
}

export function toLifecycleFolderCopyResponse(
  value: { id: string },
  skippedRestrictedItems: boolean,
): LifecycleFolderCopyResponse {
  return { id: value.id, skippedRestrictedItems };
}

function toLifecycleTimestamp(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

export function toLifecyclePageTrashItem(value: {
  id: string;
  title: string;
  icon: string | null;
  deletedAt: Date | string | null;
}): LifecyclePageTrashItem {
  return {
    id: value.id,
    title: value.title,
    icon: value.icon,
    deletedAt: toLifecycleTimestamp(value.deletedAt),
  };
}

export function toLifecycleFolderTrashItem(value: {
  id: string;
  name: string;
  icon: string | null;
  deletedAt: Date | string | null;
}): LifecycleFolderTrashItem {
  return {
    id: value.id,
    name: value.name,
    icon: value.icon,
    deletedAt: toLifecycleTimestamp(value.deletedAt),
  };
}

export function toLifecycleMarkdownImportResponse(value: {
  page: { id: string; title: string };
  warnings: Array<{
    code: 'LOCAL_IMAGES_NOT_IMPORTED';
    count: number;
    message: string;
  }>;
}): LifecycleMarkdownImportResponse {
  return {
    page: { id: value.page.id, title: value.page.title },
    warnings: value.warnings.map((warning) => ({
      code: warning.code,
      count: warning.count,
      message: warning.message,
    })),
  };
}

export function toLifecycleVaultImportResponse(value: {
  foldersCreated: number;
  pagesCreated: number;
  imagesUploaded: number;
  backlinksCreated: number;
  errors: string[];
}): LifecycleVaultImportResponse {
  return {
    foldersCreated: value.foldersCreated,
    pagesCreated: value.pagesCreated,
    imagesUploaded: value.imagesUploaded,
    backlinksCreated: value.backlinksCreated,
    errors: value.errors,
  };
}

const pageId = uuidPathParameter('pageId');
const folderId = uuidPathParameter('folderId');
const lifecycleTag = ['Lifecycle'] as const;
const importsExportsTag = ['Imports and Exports'] as const;

export const lifecycleOperations = [
  {
    method: 'post',
    ...lifecyclePaths.pageCopy,
    summary: 'Copy A Page',
    description:
      'Creates a copy of an accessible page in the requested folder. Set `parentId` to `null` to copy it to the Metakip root. The copy receives a new ID.',
    tags: lifecycleTag,
    parameters: [pageId],
    request: { required: true, ...jsonContent(parentRequestSchema) },
    responses: {
      '201': {
        description: 'The ID of the copied page.',
        content: jsonContent(lifecycleEntityResponseSchema),
      },
    },
  },
  {
    method: 'patch',
    ...lifecyclePaths.pageMove,
    summary: 'Move A Page',
    description:
      'Moves an accessible page to the requested folder. Set `parentId` to `null` to move it to the Metakip root.',
    tags: lifecycleTag,
    parameters: [pageId],
    request: { required: true, ...jsonContent(parentRequestSchema) },
    responses: {
      '200': {
        description: 'The ID of the moved page.',
        content: jsonContent(lifecycleEntityResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.pageTrash,
    summary: 'Trash A Page',
    description:
      'Moves an accessible page to Trash. Trashed pages are excluded from normal page lists and can be restored or permanently deleted.',
    tags: lifecycleTag,
    parameters: [pageId],
    responses: {
      '200': {
        description: 'Confirmation that the page was moved to Trash.',
        content: jsonContent(lifecycleDeletedResponseSchema),
      },
    },
  },
  {
    method: 'get',
    ...lifecyclePaths.pageTrashList,
    summary: 'List Trashed Pages',
    description: 'Returns pages in Trash that the caller can access.',
    tags: lifecycleTag,
    responses: {
      '200': {
        description: 'Trashed page metadata.',
        content: jsonContent(z.array(lifecyclePageTrashItemSchema)),
      },
    },
  },
  {
    method: 'patch',
    ...lifecyclePaths.pageRestore,
    summary: 'Restore A Page',
    description: 'Restores an accessible page from Trash.',
    tags: lifecycleTag,
    parameters: [pageId],
    responses: {
      '200': {
        description: 'The ID of the restored page.',
        content: jsonContent(lifecycleEntityResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.pagePermanentDelete,
    summary: 'Permanently Delete A Page',
    description: 'Permanently deletes an accessible page from Trash. This action cannot be undone.',
    tags: lifecycleTag,
    parameters: [pageId],
    responses: {
      '200': {
        description: 'Confirmation that the page was permanently deleted.',
        content: jsonContent(lifecycleDeletedResponseSchema),
      },
    },
  },
  {
    method: 'get',
    ...lifecyclePaths.pageMarkdownExport,
    summary: 'Export A Page',
    description:
      'Returns one page as markdown. When the page has attachments, the response is a ZIP containing the markdown and attachments.',
    tags: importsExportsTag,
    parameters: [pageId],
    responses: {
      '200': {
        description: 'The page as markdown, or a ZIP containing markdown and attachments.',
        content: [markdownContent(z.string()), zipContent(binaryResponseSchema)],
      },
    },
  },
  {
    method: 'post',
    ...lifecyclePaths.folderCopy,
    summary: 'Copy A Folder',
    description:
      'Copies an accessible folder and its accessible subtree to the requested folder. Set `parentId` to `null` to copy it to the Metakip root. The response reports whether restricted items were skipped.',
    tags: lifecycleTag,
    parameters: [folderId],
    request: { required: true, ...jsonContent(parentRequestSchema) },
    responses: {
      '201': {
        description: 'The copied folder ID and whether restricted items were skipped.',
        content: jsonContent(lifecycleFolderCopyResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.folderTrash,
    summary: 'Trash A Folder',
    description:
      'Moves an accessible folder and its subtree to Trash. Set `force` to `true` to confirm recursive deletion when the folder is not empty.',
    tags: lifecycleTag,
    parameters: [
      folderId,
      {
        name: 'force',
        in: 'query',
        description: 'Confirm that non-empty folders and their contents may be moved to Trash.',
        schema: { type: 'boolean', default: false },
      },
    ],
    responses: {
      '200': {
        description: 'Confirmation that the folder was moved to Trash.',
        content: jsonContent(lifecycleDeletedResponseSchema),
      },
      '409': {
        description: 'The folder is not empty. Set `force=true` to confirm recursive deletion.',
      },
    },
  },
  {
    method: 'get',
    ...lifecyclePaths.folderTrashList,
    summary: 'List Trashed Folders',
    description: 'Returns folders in Trash that the caller can access.',
    tags: lifecycleTag,
    responses: {
      '200': {
        description: 'Trashed folder metadata.',
        content: jsonContent(z.array(lifecycleFolderTrashItemSchema)),
      },
    },
  },
  {
    method: 'patch',
    ...lifecyclePaths.folderRestore,
    summary: 'Restore A Folder',
    description: 'Restores an accessible folder and its subtree from Trash.',
    tags: lifecycleTag,
    parameters: [folderId],
    responses: {
      '200': {
        description: 'The ID of the restored folder.',
        content: jsonContent(lifecycleEntityResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.folderPermanentDelete,
    summary: 'Permanently Delete A Folder',
    description:
      'Permanently deletes an accessible folder and its subtree from Trash. This action cannot be undone.',
    tags: lifecycleTag,
    parameters: [folderId],
    responses: {
      '200': {
        description: 'Confirmation and counts for the permanently deleted folders and pages.',
        content: jsonContent(lifecyclePurgeResponseSchema),
      },
    },
  },
  {
    method: 'delete',
    ...lifecyclePaths.trashEmpty,
    summary: 'Empty Trash',
    description:
      'Permanently deletes every Trash item the caller is allowed to delete. This action cannot be undone.',
    tags: lifecycleTag,
    responses: {
      '200': {
        description: 'Counts for the permanently deleted folders and pages.',
        content: jsonContent(lifecyclePurgeResponseSchema),
      },
    },
  },
  {
    method: 'post',
    ...lifecyclePaths.markdownImport,
    summary: 'Import A Page',
    description:
      'Accepts one .md file and creates a page at the Metakip root. Local image references that cannot be uploaded are returned as warnings.',
    tags: importsExportsTag,
    request: { required: true, ...multipartContent(markdownImportRequestSchema) },
    responses: {
      '201': {
        description: 'The imported page and any local-image warnings.',
        content: jsonContent(lifecycleMarkdownImportResponseSchema),
      },
    },
  },
  {
    method: 'post',
    ...lifecyclePaths.obsidianImport,
    summary: 'Import An Obsidian Vault',
    description:
      'Imports a validated Obsidian vault file list and creates its folders, pages, images, and backlinks at the Metakip root.',
    tags: importsExportsTag,
    request: {
      required: true,
      ...jsonContent(obsidianImportRequestSchema),
    },
    responses: {
      '201': {
        description: 'Counts for created folders, pages, images, backlinks, and reported errors.',
        content: jsonContent(lifecycleVaultImportResponseSchema),
      },
    },
  },
  {
    method: 'get',
    ...lifecyclePaths.workspaceExport,
    summary: 'Export All Pages',
    description: 'Returns a ZIP containing all pages the caller can access.',
    tags: importsExportsTag,
    responses: {
      '200': {
        description: 'A ZIP export of accessible pages.',
        content: zipContent(binaryResponseSchema),
      },
    },
  },
] as const satisfies readonly V1OperationContract[];
