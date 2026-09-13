import type { ApiTokenScope } from '@metakip/shared';

type LifecycleOperationPath = {
  routePath: string;
  openApiPath: string;
  requiredScopes: readonly ApiTokenScope[];
};

export const lifecyclePaths = {
  pageCopy: {
    routePath: '/pages/:id/copy',
    openApiPath: '/pages/{pageId}/copy',
    requiredScopes: ['pages:write'],
  },
  pageMove: {
    routePath: '/pages/:id/move',
    openApiPath: '/pages/{pageId}/move',
    requiredScopes: ['pages:write'],
  },
  pageTrash: {
    routePath: '/pages/:id/trash',
    openApiPath: '/pages/{pageId}/trash',
    requiredScopes: ['pages:write'],
  },
  pageTrashList: {
    routePath: '/trash/pages',
    openApiPath: '/trash/pages',
    requiredScopes: ['pages:read'],
  },
  pageRestore: {
    routePath: '/pages/:id/restore',
    openApiPath: '/pages/{pageId}/restore',
    requiredScopes: ['pages:write'],
  },
  pagePermanentDelete: {
    routePath: '/pages/:id/permanent',
    openApiPath: '/pages/{pageId}/permanent',
    requiredScopes: ['pages:write'],
  },
  pageMarkdownExport: {
    routePath: '/pages/:id/export/markdown',
    openApiPath: '/pages/{pageId}/export/markdown',
    requiredScopes: ['pages:read'],
  },
  folderCopy: {
    routePath: '/folders/:id/copy',
    openApiPath: '/folders/{folderId}/copy',
    requiredScopes: ['pages:write'],
  },
  folderTrash: {
    routePath: '/folders/:id/trash',
    openApiPath: '/folders/{folderId}/trash',
    requiredScopes: ['pages:write'],
  },
  folderTrashList: {
    routePath: '/trash/folders',
    openApiPath: '/trash/folders',
    requiredScopes: ['pages:read'],
  },
  folderRestore: {
    routePath: '/folders/:id/restore',
    openApiPath: '/folders/{folderId}/restore',
    requiredScopes: ['pages:write'],
  },
  folderPermanentDelete: {
    routePath: '/folders/:id/permanent',
    openApiPath: '/folders/{folderId}/permanent',
    requiredScopes: ['pages:write'],
  },
  trashEmpty: {
    routePath: '/trash/empty',
    openApiPath: '/trash/empty',
    requiredScopes: ['pages:write'],
  },
  markdownImport: {
    routePath: '/imports/markdown',
    openApiPath: '/imports/markdown',
    requiredScopes: ['pages:write'],
  },
  obsidianImport: {
    routePath: '/imports/obsidian',
    openApiPath: '/imports/obsidian',
    requiredScopes: ['pages:write'],
  },
  workspaceExport: {
    routePath: '/exports/workspace',
    openApiPath: '/exports/workspace',
    requiredScopes: ['pages:read'],
  },
} as const satisfies Record<string, LifecycleOperationPath>;
