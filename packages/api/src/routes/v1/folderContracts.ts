import {
  v1CreateFolderRequestSchema,
  v1FolderResolutionItemSchema,
  v1FolderResponseSchema,
  v1UpdateFolderRequestSchema,
} from '@metakip/shared';
import { z } from 'zod';
import { jsonContent, uuidPathParameter, type V1OperationContract } from './apiContract';

export const createFolderRequestSchema = v1CreateFolderRequestSchema;
export const updateFolderRequestSchema = v1UpdateFolderRequestSchema;
export const folderResponseSchema = v1FolderResponseSchema;

const folderId = uuidPathParameter('folderId');
const foldersTag = ['Folders'] as const;

export const folderOperations = {
  create: {
    method: 'post',
    routePath: '/',
    openApiPath: '/folders',
    summary: 'Create A Folder',
    description:
      'Creates a folder in the requested parent, or at the Metakip root when `parentId` is omitted or `null`.',
    tags: foldersTag,
    requiredScopes: ['pages:write'],
    request: { required: true, ...jsonContent(createFolderRequestSchema) },
    responses: {
      '201': {
        description: 'Created folder metadata.',
        content: jsonContent(folderResponseSchema),
      },
    },
  },
  resolve: {
    method: 'get',
    routePath: '/resolve',
    openApiPath: '/folders/resolve',
    summary: 'Find Folders By Exact Name',
    description:
      'Returns accessible, non-deleted folders whose names match the `name` query without regard to case. Each result includes its computed folder path.',
    tags: foldersTag,
    requiredScopes: ['pages:read'],
    parameters: [
      {
        name: 'name',
        in: 'query',
        required: true,
        description:
          'Folder name to match. Surrounding whitespace is ignored and matching is case-insensitive.',
        schema: { type: 'string', maxLength: 250 },
      },
    ],
    responses: {
      '200': {
        description: 'Accessible folders with matching names and computed folder paths.',
        content: jsonContent(z.object({ data: z.array(v1FolderResolutionItemSchema) }).strict()),
      },
    },
  },
  get: {
    method: 'get',
    routePath: '/:id',
    openApiPath: '/folders/{folderId}',
    summary: 'Get Folder Metadata',
    description: 'Returns metadata for an accessible, non-deleted folder.',
    tags: foldersTag,
    requiredScopes: ['pages:read'],
    parameters: [folderId],
    responses: {
      '200': { description: 'Folder metadata.', content: jsonContent(folderResponseSchema) },
    },
  },
  update: {
    method: 'patch',
    routePath: '/:id',
    openApiPath: '/folders/{folderId}',
    summary: 'Update Folder Metadata',
    description:
      'Updates a folder name, parent, or both. Set `parentId` to `null` to move the folder to the Metakip root.',
    tags: foldersTag,
    requiredScopes: ['pages:write'],
    parameters: [folderId],
    request: { required: true, ...jsonContent(updateFolderRequestSchema) },
    responses: {
      '200': {
        description: 'Updated folder metadata.',
        content: jsonContent(folderResponseSchema),
      },
    },
  },
  list: {
    method: 'get',
    routePath: '/',
    openApiPath: '/folders',
    summary: 'List Folders',
    description:
      'Returns a cursor-paginated list of accessible, non-deleted folders. Follow `nextCursor` until it is `null`.',
    tags: foldersTag,
    requiredScopes: ['pages:read'],
    parameters: [
      {
        name: 'cursor',
        in: 'query',
        description: 'Cursor returned by a previous list response.',
        schema: { type: 'string' },
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of folders to return. Defaults to 50 and cannot exceed 100.',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    ],
    responses: {
      '200': {
        description: 'A page of accessible folders and the cursor for the next page.',
        content: jsonContent(
          z
            .object({ data: z.array(folderResponseSchema), nextCursor: z.string().nullable() })
            .strict(),
        ),
      },
    },
  },
} as const satisfies Record<string, V1OperationContract>;
