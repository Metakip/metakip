import type { ApiTokenAuditOperation } from '@metakip/shared';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import {
  recordTokenAuditEventBestEffort,
  requireV1Auth,
  requireV1OperationScope,
} from '../../middleware/v1Auth';
import { ensureDocumentInputSize } from '../../utils/documentSize';
import {
  moveFolderToTrash,
  movePageToTrash,
  permanentlyDeletePage,
} from '../../utils/entityRemoval';
import {
  copyFolderForActor,
  listTrashedFoldersForUser,
  permanentlyDeleteFolder,
  restoreFolderForUser,
} from '../../utils/folderLifecycle';
import { importMarkdownPage } from '../../utils/markdownImport';
import { importObsidianVault } from '../../utils/obsidianImport';
import { exportPageForUser } from '../../utils/pageExport';
import {
  copyPageForActor,
  listTrashedPagesForUser,
  movePageForUser,
  restorePageForUser,
} from '../../utils/pageLifecycle';
import { emptyTrashForUser } from '../../utils/trashLifecycle';
import { exportAllPages } from '../../utils/workspaceExport';
import {
  markdownImportRequestSchema,
  obsidianImportRequestSchema,
  parentRequestSchema,
  toLifecycleDeletedResponse,
  toLifecycleEntityResponse,
  toLifecycleFolderCopyResponse,
  toLifecycleFolderTrashItem,
  toLifecycleMarkdownImportResponse,
  toLifecyclePageTrashItem,
  toLifecyclePurgeResponse,
  toLifecycleVaultImportResponse,
} from './lifecycleContracts';
import { lifecyclePaths } from './lifecyclePaths';
import { requireUuid } from './pageModel';
import { v1JsonBodyLimit } from './requestLimits';
import { parseJsonRequest, parseMultipartRequest } from './requestValidation';

function requireLifecycleId(id: string, entity: 'page' | 'folder'): string {
  return requireUuid(id, `${entity} ID`);
}

function auditLifecycleMutation(operation: ApiTokenAuditOperation) {
  return createMiddleware(async (c, next) => {
    const principal = c.get('v1Principal');
    await next();
    if (c.res.status < 200 || c.res.status >= 300) return;
    // Token audit is an observability boundary after lifecycle services commit.
    // Its best-effort implementation logs persistence failures so a successful,
    // non-idempotent mutation is never reported as a retryable 500.
    await recordTokenAuditEventBestEffort(principal, operation, 'success', null);
  });
}

const lifecycleRoute = new Hono();
for (const { routePath } of Object.values(lifecyclePaths)) {
  lifecycleRoute.use(routePath, requireV1Auth);
}

lifecycleRoute.post(
  lifecyclePaths.pageCopy.routePath,
  requireV1OperationScope(lifecyclePaths.pageCopy),
  auditLifecycleMutation('page.lifecycle'),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireLifecycleId(c.req.param('id'), 'page');
    const body = await parseJsonRequest(c, parentRequestSchema);
    const copied = await copyPageForActor(
      { kind: 'user', id: principal.userId },
      pageId,
      body.parentId,
    );
    return c.json(toLifecycleEntityResponse(copied), 201);
  },
);

lifecycleRoute.patch(
  lifecyclePaths.pageMove.routePath,
  requireV1OperationScope(lifecyclePaths.pageMove),
  auditLifecycleMutation('page.lifecycle'),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireLifecycleId(c.req.param('id'), 'page');
    const body = await parseJsonRequest(c, parentRequestSchema);
    return c.json(
      toLifecycleEntityResponse(await movePageForUser(pageId, body.parentId, principal.userId)),
    );
  },
);

lifecycleRoute.delete(
  lifecyclePaths.pageTrash.routePath,
  requireV1OperationScope(lifecyclePaths.pageTrash),
  auditLifecycleMutation('page.lifecycle'),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireLifecycleId(c.req.param('id'), 'page');
    await movePageToTrash(pageId, principal.userId);
    return c.json(toLifecycleDeletedResponse());
  },
);

lifecycleRoute.patch(
  lifecyclePaths.pageRestore.routePath,
  requireV1OperationScope(lifecyclePaths.pageRestore),
  auditLifecycleMutation('page.lifecycle'),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireLifecycleId(c.req.param('id'), 'page');
    return c.json(toLifecycleEntityResponse(await restorePageForUser(pageId, principal.userId)));
  },
);

lifecycleRoute.delete(
  lifecyclePaths.pagePermanentDelete.routePath,
  requireV1OperationScope(lifecyclePaths.pagePermanentDelete),
  auditLifecycleMutation('page.lifecycle'),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireLifecycleId(c.req.param('id'), 'page');
    await permanentlyDeletePage(pageId, principal.userId);
    return c.json(toLifecycleDeletedResponse());
  },
);

lifecycleRoute.post(
  lifecyclePaths.folderCopy.routePath,
  requireV1OperationScope(lifecyclePaths.folderCopy),
  auditLifecycleMutation('folder.lifecycle'),
  v1JsonBodyLimit,
  async (c) => {
    const principal = c.get('v1Principal');
    const folderId = requireLifecycleId(c.req.param('id'), 'folder');
    const body = await parseJsonRequest(c, parentRequestSchema);
    const result = await copyFolderForActor(
      { kind: 'user', id: principal.userId },
      folderId,
      body.parentId,
    );
    if (!result.folder) {
      throw new HTTPException(409, {
        message: 'Source folder is no longer accessible',
        cause: { code: 'SOURCE_FOLDER_UNAVAILABLE' },
      });
    }
    return c.json(toLifecycleFolderCopyResponse(result.folder, result.skippedRestrictedItems), 201);
  },
);

lifecycleRoute.delete(
  lifecyclePaths.folderTrash.routePath,
  requireV1OperationScope(lifecyclePaths.folderTrash),
  auditLifecycleMutation('folder.lifecycle'),
  async (c) => {
    const principal = c.get('v1Principal');
    const folderId = requireLifecycleId(c.req.param('id'), 'folder');
    const result = await moveFolderToTrash(
      folderId,
      principal.userId,
      c.req.query('force') === 'true',
    );
    if ('requiresForce' in result) {
      throw new HTTPException(409, {
        message: 'Folder is not empty. Confirm recursive deletion to continue.',
        cause: { code: 'FOLDER_NOT_EMPTY' },
      });
    }
    return c.json(toLifecycleDeletedResponse());
  },
);

lifecycleRoute.patch(
  lifecyclePaths.folderRestore.routePath,
  requireV1OperationScope(lifecyclePaths.folderRestore),
  auditLifecycleMutation('folder.lifecycle'),
  async (c) => {
    const principal = c.get('v1Principal');
    const folderId = requireLifecycleId(c.req.param('id'), 'folder');
    return c.json(
      toLifecycleEntityResponse(await restoreFolderForUser(folderId, principal.userId)),
    );
  },
);

lifecycleRoute.delete(
  lifecyclePaths.folderPermanentDelete.routePath,
  requireV1OperationScope(lifecyclePaths.folderPermanentDelete),
  auditLifecycleMutation('folder.lifecycle'),
  async (c) => {
    const principal = c.get('v1Principal');
    const folderId = requireLifecycleId(c.req.param('id'), 'folder');
    const result = await permanentlyDeleteFolder(folderId, principal.userId);
    return c.json(toLifecyclePurgeResponse(result));
  },
);

lifecycleRoute.delete(
  lifecyclePaths.trashEmpty.routePath,
  requireV1OperationScope(lifecyclePaths.trashEmpty),
  auditLifecycleMutation('trash.lifecycle'),
  async (c) => {
    const principal = c.get('v1Principal');
    const result = await emptyTrashForUser(principal.userId);
    return c.json(toLifecyclePurgeResponse(result));
  },
);

lifecycleRoute.post(
  lifecyclePaths.markdownImport.routePath,
  requireV1OperationScope(lifecyclePaths.markdownImport),
  auditLifecycleMutation('import.lifecycle'),
  async (c) => {
    const principal = c.get('v1Principal');
    const { file } = await parseMultipartRequest(c, markdownImportRequestSchema);
    if (!file.name.toLowerCase().endsWith('.md')) {
      throw new HTTPException(400, { message: 'File must be a markdown file' });
    }
    ensureDocumentInputSize(file);
    const result = await importMarkdownPage(principal.userId, null, file.name, await file.text());
    return c.json(toLifecycleMarkdownImportResponse(result), 201);
  },
);

lifecycleRoute.post(
  lifecyclePaths.obsidianImport.routePath,
  requireV1OperationScope(lifecyclePaths.obsidianImport),
  auditLifecycleMutation('import.lifecycle'),
  async (c) => {
    const principal = c.get('v1Principal');
    const body = await parseJsonRequest(c, obsidianImportRequestSchema);
    return c.json(
      toLifecycleVaultImportResponse(await importObsidianVault(principal.userId, body.files)),
      201,
    );
  },
);

lifecycleRoute.get(
  lifecyclePaths.pageTrashList.routePath,
  requireV1OperationScope(lifecyclePaths.pageTrashList),
  async (c) => {
    const principal = c.get('v1Principal');
    const pages = await listTrashedPagesForUser(principal.userId);
    return c.json(pages.map(toLifecyclePageTrashItem));
  },
);

lifecycleRoute.get(
  lifecyclePaths.folderTrashList.routePath,
  requireV1OperationScope(lifecyclePaths.folderTrashList),
  async (c) => {
    const principal = c.get('v1Principal');
    return c.json(
      (await listTrashedFoldersForUser(principal.userId)).map(toLifecycleFolderTrashItem),
    );
  },
);

lifecycleRoute.get(
  lifecyclePaths.pageMarkdownExport.routePath,
  requireV1OperationScope(lifecyclePaths.pageMarkdownExport),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireLifecycleId(c.req.param('id'), 'page');
    const result = await exportPageForUser(pageId, principal.userId);
    c.header('Content-Type', result.contentType);
    c.header('Content-Disposition', result.contentDisposition);
    if (typeof result.body === 'string') return c.body(result.body);
    const arrayBuffer = result.body.buffer.slice(
      result.body.byteOffset,
      result.body.byteOffset + result.body.byteLength,
    ) as ArrayBuffer;
    return c.newResponse(arrayBuffer, 200);
  },
);

lifecycleRoute.get(
  lifecyclePaths.workspaceExport.routePath,
  requireV1OperationScope(lifecyclePaths.workspaceExport),
  async (c) => {
    const principal = c.get('v1Principal');
    const buffer = await exportAllPages(principal.userId);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', 'attachment; filename="metakip-export.zip"');
    return c.newResponse(arrayBuffer, 200);
  },
);

export { lifecycleRoute };
