import {
  type CommentAnchor,
  commentAnchorSchema,
  commentListStatusSchema,
  type PageComment,
  type PageCommentThread,
  pageCommentReplyRequestSchema,
  pageCommentRequestSchema,
  pageCommentThreadStatusRequestSchema,
  pageCommentUpdateRequestSchema,
} from '@metakip/shared';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { db } from '../../db/connection';
import { executeQuery, type QueryExecutor, query } from '../../db/query';
import { requireV1OperationScope } from '../../middleware/v1Auth';
import { readPageMarkdown } from '../../utils/collaborationContentClient';
import { ensurePageAccess, lockEntityAccess } from '../../utils/share-access';
import { commentOperations as pageCommentOperations } from './commentContracts';
import { requireUuid } from './pageModel';
import { parseJsonRequest } from './requestValidation';
import { parseResourceLimit } from './resourceCursor';

type ThreadRow = {
  id: string;
  page_id: string;
  anchor: unknown;
  status: 'open' | 'resolved';
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  resolved_by: string | null;
  resolved_at: Date | string | null;
};

type OrderedThreadRow = ThreadRow & { sort_created_at: string };

type CommentOrderKey = {
  position: number | null;
  sortCreatedAt: string;
  id: string;
};

const commentCursorSchema = z
  .object({
    pageId: z.string().uuid(),
    status: commentListStatusSchema,
    etag: z.string().min(1).max(512),
    position: z.number().int().nonnegative().nullable(),
    sortCreatedAt: z.string().min(1).max(32),
    id: z.string().uuid(),
  })
  .strict();

type CommentCursor = z.infer<typeof commentCursorSchema>;

function encodeCommentCursor(cursor: CommentCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCommentCursor(
  value: string | undefined,
  pageId: string,
  status: CommentCursor['status'],
  etag: string,
): CommentCursor | null {
  if (!value) return null;
  let cursor: CommentCursor;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid cursor encoding');
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded).toString('base64url') !== value) throw new Error('Invalid cursor');
    cursor = commentCursorSchema.parse(JSON.parse(decoded) as unknown);
    if (cursor.pageId !== pageId || cursor.status !== status) throw new Error('Invalid cursor');
  } catch {
    throw new HTTPException(400, { message: 'Invalid cursor' });
  }
  if (cursor.etag !== etag) {
    throw new HTTPException(409, { message: 'Page content changed; restart comment pagination' });
  }
  return cursor;
}

function compareCommentOrder(left: CommentOrderKey, right: CommentOrderKey): number {
  const leftPosition = left.position ?? Number.POSITIVE_INFINITY;
  const rightPosition = right.position ?? Number.POSITIVE_INFINITY;
  if (leftPosition !== rightPosition) return leftPosition < rightPosition ? -1 : 1;
  return left.sortCreatedAt.localeCompare(right.sortCreatedAt) || left.id.localeCompare(right.id);
}

type AnchorMatch = { position: number; ambiguous: false } | { position: null; ambiguous: boolean };

function findAnchorMatch(markdown: string, anchor: CommentAnchor): AnchorMatch {
  let position: number | null = null;
  const prefix = anchor.prefix ?? '';
  const suffix = anchor.suffix ?? '';
  for (
    let index = markdown.indexOf(anchor.quote);
    index !== -1;
    index = markdown.indexOf(anchor.quote, index + 1)
  ) {
    if (
      (prefix.length === 0 || markdown.slice(0, index).endsWith(prefix)) &&
      (suffix.length === 0 || markdown.slice(index + anchor.quote.length).startsWith(suffix))
    ) {
      if (position !== null) return { position: null, ambiguous: true };
      position = index;
    }
  }
  return position === null ? { position: null, ambiguous: false } : { position, ambiguous: false };
}

type CommentRow = {
  id: string;
  thread_id: string;
  author_id: string | null;
  author_name: string | null;
  author_image: string | null;
  body: string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};

function timestamp(value: null): null;
function timestamp(value: Date | string): string;
function timestamp(value: Date | string | null): string | null;
function timestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Database returned an invalid timestamp');
  return date.toISOString();
}

function validateAnchorInMarkdown(markdown: string, input: CommentAnchor): CommentAnchor {
  const match = findAnchorMatch(markdown, input);
  if (match.ambiguous) {
    throw new HTTPException(400, {
      message: 'The quoted text is ambiguous; include more surrounding context',
    });
  }
  if (match.position === null) {
    throw new HTTPException(400, { message: 'The quoted text no longer exists on this page' });
  }
  return {
    quote: input.quote,
    prefix: input.prefix ?? null,
    suffix: input.suffix ?? null,
  };
}

async function getCommentRows(executor: QueryExecutor, threadIds: readonly string[]) {
  if (threadIds.length === 0) return [];
  const result = await executeQuery<CommentRow>(
    executor,
    sql`select comment.id,
               comment.thread_id,
               comment.author_id,
               author.name as author_name,
               author.image as author_image,
               comment.body,
               comment.created_at,
               comment.updated_at,
               comment.deleted_at
        from page_comments comment
        left join users author on author.id = comment.author_id
        where comment.thread_id = any(${sql.param([...threadIds])}::uuid[])
        order by comment.created_at asc, comment.id asc`,
  );
  return result.rows;
}

async function getThread(
  executor: QueryExecutor,
  pageId: string,
  threadId: string,
): Promise<PageCommentThread> {
  const result = await executeQuery<ThreadRow>(
    executor,
    sql`select thread.id,
               thread.page_id,
               thread.anchor,
               thread.status,
               thread.created_by,
               thread.created_at,
               thread.updated_at,
               thread.resolved_by,
               thread.resolved_at
        from page_comment_threads thread
        where thread.page_id = ${pageId} and thread.id = ${threadId}
        limit 1`,
  );
  const row = result.rows[0];
  if (!row) throw new HTTPException(404, { message: 'Comment thread not found' });
  const comments = await getCommentRows(executor, [row.id]);
  return {
    id: row.id,
    pageId: row.page_id,
    anchor: commentAnchorSchema.parse(row.anchor),
    status: row.status,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    resolvedBy: row.resolved_by,
    resolvedAt: timestamp(row.resolved_at),
    comments: comments.map(toCommentDto),
  };
}

function toCommentDto(row: CommentRow): PageComment {
  return {
    id: row.id,
    threadId: row.thread_id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorImage: row.author_image,
    body: row.deleted_at === null ? row.body : null,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    deletedAt: timestamp(row.deleted_at),
  };
}

async function lockThreadForMutation(
  executor: QueryExecutor,
  pageId: string,
  threadId: string,
): Promise<void> {
  const result = await executeQuery<{ id: string }>(
    executor,
    sql`select id
        from page_comment_threads
        where page_id = ${pageId} and id = ${threadId}
        for update`,
  );
  const thread = result.rows[0];
  if (!thread) throw new HTTPException(404, { message: 'Comment thread not found' });
}

async function getCommentForMutation(
  executor: QueryExecutor,
  pageId: string,
  commentId: string,
): Promise<{
  id: string;
  thread_id: string;
  author_id: string | null;
  deleted_at: Date | string | null;
}> {
  const result = await executeQuery<{
    id: string;
    thread_id: string;
    author_id: string | null;
    deleted_at: Date | string | null;
  }>(
    executor,
    sql`select comment.id, comment.thread_id, comment.author_id, comment.deleted_at
        from page_comments comment
        join page_comment_threads thread on thread.id = comment.thread_id
        where thread.page_id = ${pageId} and comment.id = ${commentId}
        for update of comment`,
  );
  const comment = result.rows[0];
  if (!comment) throw new HTTPException(404, { message: 'Comment not found' });
  return comment;
}

const pageCommentsRoute = new Hono();

pageCommentsRoute.get(
  '/:id/comments',
  requireV1OperationScope(pageCommentOperations.list),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    await ensurePageAccess(pageId, principal.userId, 'commenter');
    const rawStatus = c.req.query('status') ?? 'open';
    const status = commentListStatusSchema.safeParse(rawStatus);
    if (!status.success) throw new HTTPException(400, { message: 'Invalid comment status filter' });
    const limit = parseResourceLimit(c.req.query('limit'));
    const content = await readPageMarkdown(pageId, principal);
    const cursor = decodeCommentCursor(c.req.query('cursor'), pageId, status.data, content.etag);
    const markdown = content.markdown;
    const result = await query<OrderedThreadRow>(sql`select thread.id,
      thread.page_id,
      thread.anchor,
      thread.status,
      thread.created_by,
      thread.created_at,
      to_char(thread.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') as sort_created_at,
      thread.updated_at,
      thread.resolved_by,
      thread.resolved_at
      from page_comment_threads thread
      where thread.page_id = ${pageId}
        ${status.data === 'all' ? sql`` : sql`and thread.status = ${status.data}`}`);
    const orderedRows = result.rows
      .map((row) => {
        const anchor = commentAnchorSchema.parse(row.anchor);
        const { position } = findAnchorMatch(markdown, anchor);
        return { row, anchor, position };
      })
      .sort((left, right) => {
        return compareCommentOrder(
          {
            position: left.position,
            sortCreatedAt: left.row.sort_created_at,
            id: left.row.id,
          },
          {
            position: right.position,
            sortCreatedAt: right.row.sort_created_at,
            id: right.row.id,
          },
        );
      });
    const startIndex =
      cursor === null
        ? 0
        : orderedRows.findIndex(
            ({ row, position }) =>
              compareCommentOrder(
                { position, sortCreatedAt: row.sort_created_at, id: row.id },
                cursor,
              ) > 0,
          );
    const pageRows = startIndex === -1 ? [] : orderedRows.slice(startIndex, startIndex + limit + 1);
    const hasMore = pageRows.length > limit;
    const rows = pageRows.slice(0, limit);
    const comments = await getCommentRows(
      db,
      rows.map(({ row }) => row.id),
    );
    const byThread = new Map<string, PageComment[]>();
    for (const comment of comments) {
      const bucket = byThread.get(comment.thread_id) ?? [];
      bucket.push(toCommentDto(comment));
      byThread.set(comment.thread_id, bucket);
    }
    const data = rows.map(
      ({ row, anchor }): PageCommentThread => ({
        id: row.id,
        pageId: row.page_id,
        anchor,
        status: row.status,
        createdBy: row.created_by,
        createdAt: timestamp(row.created_at),
        updatedAt: timestamp(row.updated_at),
        resolvedBy: row.resolved_by,
        resolvedAt: timestamp(row.resolved_at),
        comments: byThread.get(row.id) ?? [],
      }),
    );
    const last = rows.at(-1);
    return c.json({
      data,
      nextCursor:
        hasMore && last
          ? encodeCommentCursor({
              pageId,
              status: status.data,
              etag: content.etag,
              position: last.position,
              sortCreatedAt: last.row.sort_created_at,
              id: last.row.id,
            })
          : null,
    });
  },
);

pageCommentsRoute.post(
  '/:id/comments',
  requireV1OperationScope(pageCommentOperations.create),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const request = await parseJsonRequest(c, pageCommentRequestSchema);
    await ensurePageAccess(pageId, principal.userId, 'commenter');
    const anchor = validateAnchorInMarkdown(
      (await readPageMarkdown(pageId, principal)).markdown,
      request.anchor,
    );
    const thread = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      await ensurePageAccess(pageId, principal.userId, 'commenter', tx);
      const insertedThread = await executeQuery<{ id: string }>(
        tx,
        sql`insert into page_comment_threads (page_id, anchor, created_by)
            values (${pageId}, ${sql.param(JSON.stringify(anchor))}::jsonb, ${principal.userId})
            returning id`,
      );
      const threadId = insertedThread.rows[0]?.id;
      if (!threadId) throw new HTTPException(500, { message: 'Failed to create comment thread' });
      await executeQuery(
        tx,
        sql`insert into page_comments (thread_id, author_id, body)
            values (${threadId}, ${principal.userId}, ${request.body})`,
      );
      return getThread(tx, pageId, threadId);
    });
    return c.json({ thread }, 201);
  },
);

pageCommentsRoute.post(
  '/:id/comments/:threadId/replies',
  requireV1OperationScope(pageCommentOperations.reply),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const threadId = requireUuid(c.req.param('threadId'), 'thread ID');
    const request = await parseJsonRequest(c, pageCommentReplyRequestSchema);
    const thread = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      await ensurePageAccess(pageId, principal.userId, 'commenter', tx);
      await lockThreadForMutation(tx, pageId, threadId);
      await executeQuery(
        tx,
        sql`insert into page_comments (thread_id, author_id, body)
            values (${threadId}, ${principal.userId}, ${request.body})`,
      );
      await executeQuery(
        tx,
        sql`update page_comment_threads
            set status = 'open', resolved_by = null, resolved_at = null, updated_at = now()
            where id = ${threadId}`,
      );
      return getThread(tx, pageId, threadId);
    });
    return c.json({ thread });
  },
);

pageCommentsRoute.patch(
  '/:id/comments/:commentId',
  requireV1OperationScope(pageCommentOperations.update),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const commentId = requireUuid(c.req.param('commentId'), 'comment ID');
    const request = await parseJsonRequest(c, pageCommentUpdateRequestSchema);
    const thread = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      await ensurePageAccess(pageId, principal.userId, 'commenter', tx);
      const comment = await getCommentForMutation(tx, pageId, commentId);
      if (comment.deleted_at !== null) {
        throw new HTTPException(409, { message: 'Deleted comments cannot be edited' });
      }
      if (comment.author_id !== principal.userId) {
        throw new HTTPException(403, { message: 'You can only edit your own comments' });
      }
      await executeQuery(
        tx,
        sql`update page_comments set body = ${request.body}, updated_at = now()
            where id = ${commentId}`,
      );
      await executeQuery(
        tx,
        sql`update page_comment_threads set updated_at = now() where id = ${comment.thread_id}`,
      );
      return getThread(tx, pageId, comment.thread_id);
    });
    return c.json({ thread });
  },
);

pageCommentsRoute.delete(
  '/:id/comments/:commentId',
  requireV1OperationScope(pageCommentOperations.remove),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const commentId = requireUuid(c.req.param('commentId'), 'comment ID');
    const thread = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      const access = await ensurePageAccess(pageId, principal.userId, 'commenter', tx);
      const comment = await getCommentForMutation(tx, pageId, commentId);
      if (comment.deleted_at !== null) {
        throw new HTTPException(409, { message: 'Comment has already been deleted' });
      }
      if (
        comment.author_id !== principal.userId &&
        !access.fullAccess &&
        access.permission !== 'admin'
      ) {
        throw new HTTPException(403, { message: 'You can only delete your own comments' });
      }
      await executeQuery(
        tx,
        sql`update page_comments
            set body = '', deleted_at = now(), updated_at = now()
            where id = ${commentId}`,
      );
      await executeQuery(
        tx,
        sql`update page_comment_threads set updated_at = now() where id = ${comment.thread_id}`,
      );
      return getThread(tx, pageId, comment.thread_id);
    });
    return c.json({ thread });
  },
);

pageCommentsRoute.patch(
  '/:id/comments/:threadId/status',
  requireV1OperationScope(pageCommentOperations.updateThreadStatus),
  async (c) => {
    const principal = c.get('v1Principal');
    const pageId = requireUuid(c.req.param('id'), 'page ID');
    const threadId = requireUuid(c.req.param('threadId'), 'thread ID');
    const request = await parseJsonRequest(c, pageCommentThreadStatusRequestSchema);
    const thread = await db.transaction(async (tx) => {
      await lockEntityAccess(tx, 'page', pageId);
      await ensurePageAccess(pageId, principal.userId, 'commenter', tx);
      await lockThreadForMutation(tx, pageId, threadId);
      await executeQuery(
        tx,
        sql`update page_comment_threads
            set status = ${request.status},
                resolved_by = ${request.status === 'resolved' ? principal.userId : null},
                resolved_at = ${request.status === 'resolved' ? sql`now()` : null},
                updated_at = now()
            where id = ${threadId}`,
      );
      return getThread(tx, pageId, threadId);
    });
    return c.json({ thread });
  },
);

export default pageCommentsRoute;
