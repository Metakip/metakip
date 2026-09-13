import {
  createMcpInternalCredential,
  MCP_INTERNAL_AUTH_HEADER,
} from '@metakip/shared/node/mcp-internal-auth';
import { type McpActor, McpBackendError } from './types';
import { responseErrorBody } from './v1ClientResponse';

export type V1ClientRequestOptions = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit;
};

export type V1ClientIO = {
  send: (
    actor: McpActor,
    path: string,
    options?: V1ClientRequestOptions,
    signal?: AbortSignal,
  ) => Promise<Response>;
  readJson: (response: Response) => Promise<unknown>;
  readMutationJson: <T>(response: Response, parse: (value: unknown) => T) => Promise<T>;
  readBytes: (response: Response, signal?: AbortSignal) => Promise<Buffer>;
  readBinaryOrMarkdown: (
    response: Response,
    contentType: string,
    signal?: AbortSignal,
  ) => Promise<Buffer | string>;
  discardResponse: (response: Response) => Promise<void>;
};

export type V1ClientTransportOptions = {
  baseUrl: string;
  fetcher?: typeof fetch;
};

type RequestOutcomeClass = 'read' | 'idempotent_mutation' | 'unsafe_mutation';

function classifyRequest(method: string, headers: Headers): RequestOutcomeClass {
  if (method === 'GET' || method === 'HEAD') return 'read';
  return (headers.get('Idempotency-Key')?.trim().length ?? 0) > 0
    ? 'idempotent_mutation'
    : 'unsafe_mutation';
}

function isOutcomeUncertain(classification: RequestOutcomeClass, status?: number): boolean {
  return classification === 'unsafe_mutation' && (status === undefined || status >= 500);
}

function errorDetails(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function transportFailure(classification: RequestOutcomeClass, error: unknown): McpBackendError {
  if (isOutcomeUncertain(classification)) {
    return new McpBackendError('Mutation outcome is uncertain; do not retry automatically', 503, {
      code: 'outcome_uncertain',
      details: errorDetails(error),
    });
  }
  return new McpBackendError('Metakip API is unavailable', 503, {
    code: 'service_unavailable',
    details: errorDetails(error),
  });
}

function invalidErrorResponse(
  classification: RequestOutcomeClass,
  status: number,
  error: unknown,
): McpBackendError {
  const uncertain = isOutcomeUncertain(classification, status);
  return new McpBackendError(
    uncertain
      ? 'Mutation error response was invalid; outcome is uncertain'
      : 'Metakip API returned an invalid error response',
    503,
    {
      code: uncertain ? 'outcome_uncertain' : 'invalid_upstream_response',
      details: errorDetails(error),
    },
  );
}

function invalidMutationResponse(
  classification: RequestOutcomeClass,
  error: unknown,
): McpBackendError {
  if (isOutcomeUncertain(classification)) {
    return new McpBackendError('Mutation response was invalid; outcome is uncertain', 503, {
      code: 'outcome_uncertain',
      details: error instanceof McpBackendError ? error.details : errorDetails(error),
    });
  }
  return new McpBackendError('Metakip API returned an invalid mutation response', 503, {
    code: 'invalid_upstream_response',
    details: error instanceof McpBackendError ? error.details : errorDetails(error),
  });
}

export class V1ClientTransport {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly responseOutcomeClasses = new WeakMap<Response, RequestOutcomeClass>();

  constructor(options: V1ClientTransportOptions) {
    const base = new URL(options.baseUrl);
    this.baseUrl = base.toString().replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch;
  }

  protected async readBinaryOrMarkdown(
    response: Response,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<Buffer | string> {
    const bytes = await this.readBytes(response, signal);
    if (contentType.toLowerCase().startsWith('text/markdown')) {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) {
        throw new McpBackendError('Metakip export returned invalid UTF-8', 503, {
          code: 'invalid_upstream_response',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return bytes;
  }

  protected async readMutationJson<T>(
    response: Response,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const outcomeClass = this.responseOutcomeClasses.get(response) ?? 'unsafe_mutation';
    try {
      return parse(await this.readJson(response));
    } catch (error) {
      if (error instanceof McpBackendError && error.code === 'outcome_uncertain') {
        throw error;
      }
      throw invalidMutationResponse(outcomeClass, error);
    }
  }

  protected async readBytes(response: Response, signal?: AbortSignal): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        chunks.push(value);
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      throw new McpBackendError('Metakip export response could not be read', 503, {
        code: 'invalid_upstream_response',
        details: error instanceof Error ? error.message : String(error),
      });
    } finally {
      reader.releaseLock();
    }

    const result = Buffer.allocUnsafe(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  protected async discardResponse(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch (error) {
      const outcomeClass = this.responseOutcomeClasses.get(response) ?? 'unsafe_mutation';
      throw invalidMutationResponse(outcomeClass, error);
    }
  }

  protected async send(
    actor: McpActor,
    path: string,
    options: V1ClientRequestOptions = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    // The OAuth bearer token terminates at MCP. Only the signed private
    // MCP-to-API context crosses this service boundary.
    headers.delete('Authorization');
    headers.set(
      MCP_INTERNAL_AUTH_HEADER,
      createMcpInternalCredential(actor.authContext, actor.apiInternalSecret),
    );
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    const method = (options.method ?? 'GET').toUpperCase();
    const outcomeClass = classifyRequest(method, headers);
    const request: RequestInit = {
      method,
      headers,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    };
    if (options.body !== undefined) request.body = options.body;
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, request);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      throw transportFailure(outcomeClass, error);
    }
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw invalidErrorResponse(outcomeClass, response.status, error);
      }
      let error: ReturnType<typeof responseErrorBody>;
      try {
        error = responseErrorBody(body);
      } catch (parseError) {
        throw invalidErrorResponse(outcomeClass, response.status, parseError);
      }
      if (response.status === 401) {
        throw new McpBackendError('MCP access token is no longer valid', 401, {
          code: 'invalid_token',
          ...(error.details === undefined ? {} : { details: error.details }),
        });
      }
      const responseCode = isOutcomeUncertain(outcomeClass, response.status)
        ? 'outcome_uncertain'
        : error.code;
      throw new McpBackendError(error.message, response.status, {
        ...(responseCode ? { code: responseCode } : {}),
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }
    this.responseOutcomeClasses.set(response, outcomeClass);
    return response;
  }

  protected async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new McpBackendError('Metakip API returned invalid JSON', 503, {
        code: 'invalid_upstream_response',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
