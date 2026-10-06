import {
  type CommentAnchor,
  type CommentListStatus,
  type CommentThreadStatus,
  type PageCommentThread,
  type PageCommentThreadsResponse,
  pageCommentThreadResponseSchema,
  pageCommentThreadsResponseSchema,
} from '@metakip/shared';
import type { McpActor, McpRequestOptions } from './types';
import { parseApiResponse } from './v1ClientResponse';
import type { V1ClientIO } from './v1ClientTransport';

export class V1CommentClient {
  constructor(private readonly io: V1ClientIO) {}

  async listPageComments(
    actor: McpActor,
    reference: string,
    input: { status?: CommentListStatus; cursor?: string; limit?: number },
    options?: McpRequestOptions,
  ): Promise<PageCommentThreadsResponse> {
    const query = new URLSearchParams();
    if (input.status !== undefined) query.set('status', input.status);
    if (input.cursor !== undefined) query.set('cursor', input.cursor);
    if (input.limit !== undefined) query.set('limit', String(input.limit));
    return parseApiResponse(
      pageCommentThreadsResponseSchema,
      await this.io.readJson(
        await this.io.send(
          actor,
          `/pages/${reference}/comments?${query.toString()}`,
          {},
          options?.signal,
        ),
      ),
    );
  }

  async addPageComment(
    actor: McpActor,
    reference: string,
    input: { body: string; anchor: CommentAnchor },
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.mutateThread(actor, `/pages/${reference}/comments`, 'POST', input, options);
  }

  async replyToComment(
    actor: McpActor,
    reference: string,
    threadId: string,
    body: string,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.mutateThread(
      actor,
      `/pages/${reference}/comments/${threadId}/replies`,
      'POST',
      { body },
      options,
    );
  }

  async editComment(
    actor: McpActor,
    reference: string,
    commentId: string,
    body: string,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.mutateThread(
      actor,
      `/pages/${reference}/comments/${commentId}`,
      'PATCH',
      { body },
      options,
    );
  }

  async deleteComment(
    actor: McpActor,
    reference: string,
    commentId: string,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.mutateThread(
      actor,
      `/pages/${reference}/comments/${commentId}`,
      'DELETE',
      undefined,
      options,
    );
  }

  async setCommentThreadStatus(
    actor: McpActor,
    reference: string,
    threadId: string,
    status: CommentThreadStatus,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    return this.mutateThread(
      actor,
      `/pages/${reference}/comments/${threadId}/status`,
      'PATCH',
      { status },
      options,
    );
  }

  private async mutateThread(
    actor: McpActor,
    path: string,
    method: string,
    body: unknown,
    options?: McpRequestOptions,
  ): Promise<PageCommentThread> {
    const response = await this.io.send(
      actor,
      path,
      {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
      },
      options?.signal,
    );
    return this.io.readMutationJson(
      response,
      (value) => parseApiResponse(pageCommentThreadResponseSchema, value).thread,
    );
  }
}
