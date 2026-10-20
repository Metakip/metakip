import type { McpActor, McpRequestOptions, McpSearch } from './types';
import { mcpSearchSchema } from './types';
import { parseApiResponse } from './v1ClientResponse';
import type { V1ClientIO } from './v1ClientTransport';

export class V1SearchClient {
  constructor(private readonly io: V1ClientIO) {}

  async search(actor: McpActor, query: string, options?: McpRequestOptions): Promise<McpSearch> {
    const params = new URLSearchParams({ q: query });
    const response = await this.io.send(actor, `/search?${params.toString()}`, {}, options?.signal);
    return parseApiResponse(mcpSearchSchema, await this.io.readJson(response));
  }
}
