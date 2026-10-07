import { z } from 'zod';
import { v1UuidSchema } from './v1.js';

export const COMMENT_BODY_MAX_LENGTH = 10_000;
export const COMMENT_ANCHOR_TEXT_MAX_LENGTH = 100_000;
export const COMMENT_ANCHOR_CONTEXT_MAX_LENGTH = 200;

export const commentAnchorSchema = z
  .object({
    quote: z
      .string()
      .min(1)
      .max(COMMENT_ANCHOR_TEXT_MAX_LENGTH)
      .refine((value) => value.trim().length > 0),
    prefix: z.string().max(COMMENT_ANCHOR_CONTEXT_MAX_LENGTH).nullable().optional(),
    suffix: z.string().max(COMMENT_ANCHOR_CONTEXT_MAX_LENGTH).nullable().optional(),
  })
  .strict();

export const commentThreadStatusSchema = z.enum(['open', 'resolved']);
export const commentListStatusSchema = z.enum(['open', 'resolved', 'all']);

export const pageCommentSchema = z
  .object({
    id: v1UuidSchema,
    threadId: v1UuidSchema,
    authorId: v1UuidSchema.nullable(),
    authorName: z.string().nullable(),
    authorImage: z.string().nullable(),
    body: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
  })
  .strict();

export const pageCommentThreadSchema = z
  .object({
    id: v1UuidSchema,
    pageId: v1UuidSchema,
    anchor: commentAnchorSchema,
    status: commentThreadStatusSchema,
    createdBy: v1UuidSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    resolvedBy: v1UuidSchema.nullable(),
    resolvedAt: z.string().nullable(),
    comments: z.array(pageCommentSchema),
  })
  .strict();

export const pageCommentThreadsResponseSchema = z
  .object({
    data: z.array(pageCommentThreadSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const pageCommentThreadResponseSchema = z
  .object({ thread: pageCommentThreadSchema })
  .strict();

export const pageCommentRequestSchema = z
  .object({
    body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH),
    anchor: commentAnchorSchema,
  })
  .strict();

export const pageCommentReplyRequestSchema = z
  .object({ body: z.string().trim().min(1).max(COMMENT_BODY_MAX_LENGTH) })
  .strict();

export const pageCommentUpdateRequestSchema = pageCommentReplyRequestSchema;

export const pageCommentThreadStatusRequestSchema = z
  .object({ status: commentThreadStatusSchema })
  .strict();

export type CommentAnchor = z.infer<typeof commentAnchorSchema>;
export type CommentListStatus = z.infer<typeof commentListStatusSchema>;
export type CommentThreadStatus = z.infer<typeof commentThreadStatusSchema>;
export type PageComment = z.infer<typeof pageCommentSchema>;
export type PageCommentThread = z.infer<typeof pageCommentThreadSchema>;
export type PageCommentThreadsResponse = z.infer<typeof pageCommentThreadsResponseSchema>;
