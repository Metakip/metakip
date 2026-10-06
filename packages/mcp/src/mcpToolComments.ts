import {
  COMMENT_BODY_MAX_LENGTH,
  commentAnchorSchema,
  commentListStatusSchema,
  commentThreadStatusSchema,
  pageCommentThreadResponseSchema,
  pageCommentThreadsResponseSchema,
} from '@metakip/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  destructiveAnnotations,
  readAnnotations,
  registerTool,
  writeAnnotations,
} from './mcpToolRegistration';
import type { McpCommentsBackend } from './types';

export function registerCommentTools(
  server: McpServer,
  backend: McpCommentsBackend,
  canReadComments: boolean,
  canWriteComments: boolean,
): void {
  if (!canReadComments) return;

  registerTool(
    server,
    'list_page_comments',
    'List linear comment threads on a page by page UUID. Use status=open for active discussion, resolved for completed threads, or all for both. Results include the anchor quote and comments in chronological order; replies are not nested.',
    {
      page: z.string().uuid(),
      status: commentListStatusSchema.optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    readAnnotations,
    pageCommentThreadsResponseSchema,
    (input, options) =>
      backend.listPageComments(
        input.page,
        {
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        },
        options,
      ),
  );

  if (!canWriteComments) return;

  registerTool(
    server,
    'add_page_comment',
    'Start a comment thread anchored to selected page text using the page UUID. Provide the exact selected quote and optional surrounding context; to comment on the page as a whole, provide the exact full-page selection. Do not send editor offsets.',
    {
      page: z.string().uuid(),
      body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH),
      anchor: commentAnchorSchema,
    },
    writeAnnotations,
    pageCommentThreadResponseSchema,
    (input, options) =>
      backend
        .addPageComment(input.page, { body: input.body, anchor: input.anchor }, options)
        .then((thread) => ({ thread })),
  );

  registerTool(
    server,
    'reply_to_comment',
    'Reply to a comment thread by page UUID and root thread ID. Every reply stays in the same linear thread; nested replies are not supported.',
    {
      page: z.string().uuid(),
      threadId: z.string().uuid(),
      body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH),
    },
    writeAnnotations,
    pageCommentThreadResponseSchema,
    (input, options) =>
      backend.replyToComment(input.page, input.threadId, input.body, options).then((thread) => ({
        thread,
      })),
  );

  registerTool(
    server,
    'edit_comment',
    'Edit a comment you authored, identified by the page UUID. The comment body is plain text and the thread remains linear.',
    {
      page: z.string().uuid(),
      commentId: z.string().uuid(),
      body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH),
    },
    writeAnnotations,
    pageCommentThreadResponseSchema,
    (input, options) =>
      backend.editComment(input.page, input.commentId, input.body, options).then((thread) => ({
        thread,
      })),
  );

  registerTool(
    server,
    'delete_comment',
    'Delete a comment you authored, or a comment you can moderate, identified by the page UUID. This leaves a deleted-comment marker in the linear thread.',
    { page: z.string().uuid(), commentId: z.string().uuid() },
    destructiveAnnotations,
    pageCommentThreadResponseSchema,
    (input, options) =>
      backend.deleteComment(input.page, input.commentId, options).then((thread) => ({ thread })),
  );

  registerTool(
    server,
    'set_comment_thread_status',
    'Resolve or reopen a comment thread, identified by page UUID. Commenters can change the status of any thread; this does not delete comments.',
    {
      page: z.string().uuid(),
      threadId: z.string().uuid(),
      status: commentThreadStatusSchema,
    },
    writeAnnotations,
    pageCommentThreadResponseSchema,
    (input, options) =>
      backend
        .setCommentThreadStatus(input.page, input.threadId, input.status, options)
        .then((thread) => ({ thread })),
  );
}
