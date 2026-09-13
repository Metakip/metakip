import { randomUUID } from 'node:crypto';
import type { CallToolResult, McpServer, ToolCallback } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { McpBackendError, type McpPage, type McpRequestOptions } from './types';

export const MCP_MAX_BATCH_REFERENCES = 100;

type AnySchema = z.ZodType;
type SchemaOutput<Schema extends AnySchema> = z.output<Schema>;

type JsonObject = Record<string, unknown>;
export type McpAnnotations =
  | typeof readAnnotations
  | typeof writeAnnotations
  | typeof destructiveAnnotations;

export const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

export const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const;

function asStructuredContent(value: unknown): JsonObject {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return { data: value };
}

function validatedStructuredContent(schema: AnySchema, value: unknown): JsonObject {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new McpBackendError('MCP backend returned an invalid tool result', 503, {
      code: 'invalid_backend_result',
    });
  }
  return asStructuredContent(parsed.data);
}

function jsonResult(schema: AnySchema, value: unknown): CallToolResult {
  const structuredContent = validatedStructuredContent(schema, value);
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function statusErrorCode(status: number): string {
  if (status === 400 || status === 422) return 'invalid_arguments';
  if (status === 401) return 'not_authenticated';
  if (status === 403) return 'insufficient_scope';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'content_too_large';
  if (status === 503) return 'service_unavailable';
  return 'tool_error';
}

function backendErrorCode(error: McpBackendError | undefined, status: number | undefined): string {
  if (error?.code === 'unauthorized') return 'not_authenticated';
  return error?.code ?? (status === undefined ? 'tool_error' : statusErrorCode(status));
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const backendError = error instanceof McpBackendError ? error : undefined;
  const status = backendError?.status;
  const details = backendError?.details;
  const errorBody: JsonObject = {
    error: {
      code: backendErrorCode(backendError, status),
      message,
      ...(status === undefined ? {} : { statusCode: status }),
      ...(details === undefined ? {} : { details }),
    },
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(errorBody) }],
    isError: true,
  };
}

function resourceResult(
  value: {
    body: Buffer | string;
    contentType: string;
    contentDisposition: string;
    metadata: JsonObject;
  },
  outputSchema: AnySchema,
): CallToolResult {
  const structuredValue = {
    ...value.metadata,
    ...(typeof value.body === 'string' ? { content: value.body } : {}),
  };
  const structuredContent = validatedStructuredContent(outputSchema, structuredValue);
  if (typeof value.body === 'string') {
    return {
      content: [
        { type: 'text', text: value.body },
        { type: 'text', text: JSON.stringify(value.metadata) },
      ],
      structuredContent,
    };
  }
  const resourceUri = `urn:metakip:export:${randomUUID()}`;
  return {
    content: [
      {
        type: 'resource',
        resource: {
          uri: resourceUri,
          mimeType: value.contentType,
          blob: value.body.toString('base64'),
        },
      },
      { type: 'text', text: JSON.stringify(value.metadata) },
    ],
    structuredContent,
  };
}

export function registerTool<Shape extends z.ZodRawShape, OutputSchema extends AnySchema>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Shape,
  annotations: McpAnnotations,
  outputSchema: OutputSchema,
  handler: (
    input: z.infer<z.ZodObject<Shape>>,
    options: McpRequestOptions,
  ) => Promise<SchemaOutput<OutputSchema>>,
  validateInput?: (input: z.infer<z.ZodObject<Shape>>) => void,
): void {
  const schema = z.object(inputSchema);
  const callback: ToolCallback<typeof schema> = async (input, context) => {
    const options = { signal: context.mcpReq.signal };
    try {
      validateInput?.(input);
      return jsonResult(outputSchema, await handler(input, options));
    } catch (error) {
      if (options.signal.aborted) throw error;
      return errorResult(error);
    }
  };
  server.registerTool<AnySchema, typeof schema>(
    name,
    { description, inputSchema: schema, outputSchema, annotations },
    callback,
  );
}

export function registerExportTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Shape,
  outputSchema: AnySchema,
  handler: (
    input: z.infer<z.ZodObject<Shape>>,
    options: McpRequestOptions,
  ) => Promise<{
    body: Buffer | string;
    contentType: string;
    contentDisposition: string;
    pageId?: string;
    page?: McpPage;
  }>,
): void {
  const schema = z.object(inputSchema);
  const callback: ToolCallback<typeof schema> = async (input, context) => {
    const options = { signal: context.mcpReq.signal };
    try {
      const result = await handler(input, options);
      return resourceResult(
        {
          body: result.body,
          contentType: result.contentType,
          contentDisposition: result.contentDisposition,
          metadata: {
            ...(result.pageId ? { pageId: result.pageId } : {}),
            ...(result.page ? { page: result.page } : {}),
            format: result.contentType === 'text/markdown' ? 'markdown' : 'zip',
            bytes:
              typeof result.body === 'string'
                ? Buffer.byteLength(result.body)
                : result.body.byteLength,
            contentDisposition: result.contentDisposition,
          },
        },
        outputSchema,
      );
    } catch (error) {
      if (options.signal.aborted) throw error;
      return errorResult(error);
    }
  };
  server.registerTool<AnySchema, typeof schema>(
    name,
    { description, inputSchema: schema, outputSchema, annotations: readAnnotations },
    callback,
  );
}
