import type { ApiTokenScope } from '@metakip/shared';
import {
  pageCommentReplyRequestSchema,
  pageCommentRequestSchema,
  pageCommentThreadResponseSchema,
  pageCommentThreadStatusRequestSchema,
  pageCommentThreadsResponseSchema,
  pageCommentUpdateRequestSchema,
} from '@metakip/shared';
import type { z } from 'zod';
import { jsonContent, uuidPathParameter, type V1OperationContract } from './apiContract';

const pageIdParameter = uuidPathParameter('pageId');
const commentIdParameter = uuidPathParameter('commentId');
const threadIdParameter = uuidPathParameter('threadId');
const commentsTag = ['Comments'] as const;

function operation(
  method: V1OperationContract['method'],
  routePath: string,
  openApiPath: string,
  summary: string,
  requiredScope: ApiTokenScope,
  request?: { schema: z.ZodType; required: boolean },
  parameters?: readonly Readonly<Record<string, unknown>>[],
  successStatus: '200' | '201' = '200',
): V1OperationContract {
  return {
    method,
    routePath,
    openApiPath,
    summary,
    tags: commentsTag,
    requiredScopes: [requiredScope],
    ...(parameters ? { parameters } : {}),
    ...(request ? { request: { required: request.required, ...jsonContent(request.schema) } } : {}),
    responses: {
      [successStatus]: {
        description: 'The requested comment data.',
        content: jsonContent(
          method === 'get' ? pageCommentThreadsResponseSchema : pageCommentThreadResponseSchema,
        ),
      },
    },
  };
}

export const commentOperations = {
  list: operation(
    'get',
    '/:id/comments',
    '/pages/{pageId}/comments',
    'List Page Comments',
    'pages:comment',
    undefined,
    [
      pageIdParameter,
      {
        name: 'status',
        in: 'query',
        description: 'Filter by thread status. Defaults to open.',
        schema: { type: 'string', enum: ['open', 'resolved', 'all'], default: 'open' },
      },
      {
        name: 'cursor',
        in: 'query',
        description: 'Cursor returned by a previous list response.',
        schema: { type: 'string' },
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of threads to return. Defaults to 50 and cannot exceed 100.',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    ],
  ),
  create: operation(
    'post',
    '/:id/comments',
    '/pages/{pageId}/comments',
    'Create A Page Comment Thread',
    'pages:comment',
    { schema: pageCommentRequestSchema, required: true },
    [pageIdParameter],
    '201',
  ),
  reply: operation(
    'post',
    '/:id/comments/:threadId/replies',
    '/pages/{pageId}/comments/{threadId}/replies',
    'Reply To A Comment Thread',
    'pages:comment',
    { schema: pageCommentReplyRequestSchema, required: true },
    [pageIdParameter, threadIdParameter],
  ),
  update: operation(
    'patch',
    '/:id/comments/:commentId',
    '/pages/{pageId}/comments/{commentId}',
    'Edit A Comment',
    'pages:comment',
    { schema: pageCommentUpdateRequestSchema, required: true },
    [pageIdParameter, commentIdParameter],
  ),
  remove: operation(
    'delete',
    '/:id/comments/:commentId',
    '/pages/{pageId}/comments/{commentId}',
    'Delete A Comment',
    'pages:comment',
    undefined,
    [pageIdParameter, commentIdParameter],
  ),
  updateThreadStatus: operation(
    'patch',
    '/:id/comments/:threadId/status',
    '/pages/{pageId}/comments/{threadId}/status',
    'Resolve Or Reopen A Comment Thread',
    'pages:comment',
    { schema: pageCommentThreadStatusRequestSchema, required: true },
    [pageIdParameter, threadIdParameter],
  ),
} as const satisfies Record<string, V1OperationContract>;
