import {
  type McpActor,
  McpBackendError,
  type McpContentOperation,
  type McpExactEdit,
  type McpPage,
  type McpPageList,
  type McpReadPage,
  type McpReplacePage,
  type McpRequestOptions,
  mcpContentOperationSchema,
  mcpExactEditSchema,
  mcpPageListSchema,
  mcpPageResolutionSchema,
  mcpReadPageSchema,
  mcpReplacePageSchema,
} from './types';
import {
  asString,
  isUuid,
  type JsonRecord,
  type PageReference,
  pageOutput,
  parseApiResponse,
  requireEtag,
  type TextResponse,
} from './v1ClientResponse';
import type { V1ClientIO } from './v1ClientTransport';

export class V1PageClient {
  constructor(private readonly io: V1ClientIO) {}

  async listPages(
    actor: McpActor,
    input: { cursor?: string; limit?: number; parentId?: string },
    options?: McpRequestOptions,
  ): Promise<McpPageList> {
    const query = new URLSearchParams();
    if (input.cursor !== undefined) query.set('cursor', input.cursor);
    if (input.limit !== undefined) query.set('limit', String(input.limit));
    if (input.parentId !== undefined) query.set('parentId', input.parentId);
    return parseApiResponse(
      mcpPageListSchema,
      await this.io.readJson(
        await this.io.send(actor, `/pages?${query.toString()}`, {}, options?.signal),
      ),
    );
  }

  async readPage(
    actor: McpActor,
    reference: string,
    options?: McpRequestOptions,
  ): Promise<McpReadPage> {
    const resolved = await this.resolvePage(actor, reference, options?.signal);
    const content = await this.readContent(actor, resolved.id, options?.signal);
    return parseApiResponse(mcpReadPageSchema, {
      page: resolved.page,
      markdown: content.body,
      etag: requireEtag(content.etag),
    });
  }

  async createPage(
    actor: McpActor,
    input: { title?: string; parentId?: string | null; icon?: string | null; markdown?: string },
    options?: McpRequestOptions,
  ): Promise<McpPage> {
    const body: JsonRecord = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.parentId !== undefined) body.parentId = input.parentId;
    if (input.icon !== undefined) body.icon = input.icon;
    if (input.markdown !== undefined) body.markdown = input.markdown;
    return this.io.readMutationJson(
      await this.io.send(
        actor,
        '/pages',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        options?.signal,
      ),
      pageOutput,
    );
  }

  async updatePage(
    actor: McpActor,
    reference: string,
    input: { title?: string; icon?: string | null; clearIcon?: boolean },
    options?: McpRequestOptions,
  ): Promise<McpPage> {
    const page = await this.resolvePage(actor, reference, options?.signal);
    const body: JsonRecord = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.clearIcon) body.icon = null;
    else if (input.icon !== undefined) body.icon = input.icon;
    return this.io.readMutationJson(
      await this.io.send(
        actor,
        `/pages/${page.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        options?.signal,
      ),
      pageOutput,
    );
  }

  async replacePage(
    actor: McpActor,
    reference: string,
    markdown: string,
    options?: McpRequestOptions,
  ): Promise<McpReplacePage> {
    const page = await this.resolvePage(actor, reference, options?.signal);
    const current = await this.readContent(actor, page.id, options?.signal);
    const currentEtag = requireEtag(current.etag);
    const response = await this.io.send(
      actor,
      `/pages/${page.id}/content`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'text/markdown; charset=UTF-8', 'If-Match': currentEtag },
        body: markdown,
      },
      options?.signal,
    );
    const etag = response.headers.get('etag');
    await this.io.discardResponse(response);
    if (!etag) {
      throw new McpBackendError('Mutation response did not include an ETag', 503, {
        code: 'outcome_uncertain',
      });
    }
    let updatedPage: McpPage;
    try {
      updatedPage = pageOutput(
        await this.io.readJson(await this.io.send(actor, `/pages/${page.id}`, {}, options?.signal)),
      );
    } catch (error) {
      // The content write already committed; do not return stale metadata or
      // imply that retrying the non-idempotent write is safe.
      throw new McpBackendError(
        'Page content was replaced, but updated page metadata could not be read',
        503,
        {
          code: 'outcome_uncertain',
          details:
            error instanceof McpBackendError
              ? error.details
              : error instanceof Error
                ? error.message
                : String(error),
        },
      );
    }
    return parseApiResponse(mcpReplacePageSchema, {
      page: updatedPage,
      changed: current.body !== markdown,
      etag,
    });
  }

  async editPageExact(
    actor: McpActor,
    reference: string,
    input: { oldText: string; newText: string; editId?: string; idempotencyKey: string },
    options?: McpRequestOptions,
  ): Promise<McpExactEdit> {
    const page = await this.resolvePage(actor, reference, options?.signal);
    const body = {
      edits: [
        {
          id: input.editId ?? input.idempotencyKey,
          oldText: input.oldText,
          newText: input.newText,
        },
      ],
    };
    return this.io.readMutationJson(
      await this.io.send(
        actor,
        `/pages/${page.id}/edits`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': input.idempotencyKey,
          },
          body: JSON.stringify(body),
        },
        options?.signal,
      ),
      (value) => parseApiResponse(mcpExactEditSchema, value),
    );
  }

  async appendToPage(
    actor: McpActor,
    reference: string,
    input: { content: string; editId?: string; idempotencyKey: string },
    options?: McpRequestOptions,
  ): Promise<McpContentOperation> {
    return this.boundaryOperation(actor, reference, 'append', input, options?.signal);
  }

  async prependToPage(
    actor: McpActor,
    reference: string,
    input: { content: string; editId?: string; idempotencyKey: string },
    options?: McpRequestOptions,
  ): Promise<McpContentOperation> {
    return this.boundaryOperation(actor, reference, 'prepend', input, options?.signal);
  }

  async resolvePage(
    actor: McpActor,
    reference: string,
    signal?: AbortSignal,
  ): Promise<PageReference> {
    if (isUuid(reference)) {
      const page = pageOutput(
        await this.io.readJson(await this.io.send(actor, `/pages/${reference}`, {}, signal)),
      );
      return { id: page.id, page };
    }
    const query = new URLSearchParams({ title: reference });
    const body = parseApiResponse(
      mcpPageResolutionSchema,
      await this.io.readJson(
        await this.io.send(actor, `/pages/resolve?${query.toString()}`, {}, signal),
      ),
    );
    const rows = body.data;
    if (rows.length === 0) {
      throw new McpBackendError(`No page titled ${JSON.stringify(reference)}`, 404);
    }
    if (rows.length > 1) {
      throw new McpBackendError(`Page reference ${JSON.stringify(reference)} is ambiguous`, 409, {
        code: 'ambiguous_page',
        details: {
          candidates: rows.map((value) => {
            return {
              id: value.id,
              title: value.title,
              folderPath: value.folderPath,
            };
          }),
        },
      });
    }
    const row = rows[0];
    if (row === undefined) throw new McpBackendError('Page not found', 404);
    const page = pageOutput(row);
    return { id: asString(page.id, 'id'), page };
  }

  async readContent(actor: McpActor, id: string, signal?: AbortSignal): Promise<TextResponse> {
    const response = await this.io.send(actor, `/pages/${id}/content`, {}, signal);
    return {
      body: await response.text(),
      etag: response.headers.get('etag'),
    };
  }

  private async boundaryOperation(
    actor: McpActor,
    reference: string,
    operation: 'append' | 'prepend',
    input: { content: string; editId?: string; idempotencyKey: string },
    signal?: AbortSignal,
  ): Promise<McpContentOperation> {
    const page = await this.resolvePage(actor, reference, signal);
    return this.io.readMutationJson(
      await this.io.send(
        actor,
        `/pages/${page.id}/content-operations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': input.idempotencyKey,
          },
          body: JSON.stringify({
            id: input.editId ?? input.idempotencyKey,
            operation,
            content: input.content,
          }),
        },
        signal,
      ),
      (value) => parseApiResponse(mcpContentOperationSchema, value),
    );
  }
}
