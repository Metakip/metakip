import type { ApiTokenScope } from '@metakip/shared';
import { z } from 'zod';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type SchemaContent = {
  mediaType: 'application/json' | 'application/zip' | 'multipart/form-data' | 'text/markdown';
  schema: z.ZodType;
};

export const binaryResponseSchema = z.string().meta({ format: 'binary' });

type ResponseContract = {
  description: string;
  content?: SchemaContent | readonly SchemaContent[];
  headers?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
};

export type V1OperationContract = {
  method: HttpMethod;
  routePath: string;
  openApiPath: string;
  summary: string;
  description?: string;
  tags?: readonly string[];
  parameters?: readonly Readonly<Record<string, unknown>>[];
  request?: SchemaContent & { required: boolean };
  responses: Readonly<Record<string, ResponseContract>>;
  security?: readonly Readonly<Record<string, readonly string[]>>[];
  requiredScopes: readonly ApiTokenScope[];
};

function documentationSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function contentDocument(
  content: SchemaContent | readonly SchemaContent[],
): Record<string, unknown> {
  const entries = Array.isArray(content) ? content : [content];
  return Object.fromEntries(
    entries.map((entry) => [
      entry.mediaType,
      {
        schema: z.toJSONSchema(entry.schema),
      },
    ]),
  );
}

export function buildOpenApiPaths(
  operations: readonly V1OperationContract[],
): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  const pathCounts = new Map<string, number>();
  for (const operation of operations) {
    pathCounts.set(operation.openApiPath, (pathCounts.get(operation.openApiPath) ?? 0) + 1);
  }

  for (const contract of operations) {
    const responses: Record<string, unknown> = Object.fromEntries(
      Object.entries(contract.responses).map(([status, response]) => [
        status,
        {
          description: response.description,
          ...(response.content ? { content: contentDocument(response.content) } : {}),
          ...(response.headers ? { headers: response.headers } : {}),
        },
      ]),
    );
    if (contract.requiredScopes.length > 0 && responses['403'] === undefined) {
      responses['403'] = {
        description: `The API token is missing a required scope: ${contract.requiredScopes.join(', ')}.`,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      };
    }
    const pathSlug = documentationSlug(contract.openApiPath);
    const routeSlug =
      pathCounts.get(contract.openApiPath) === 1
        ? pathSlug
        : `${pathSlug}-${documentationSlug(contract.method)}`;
    const operation = {
      operationId: routeSlug,
      summary: contract.summary,
      ...(contract.description ? { description: contract.description } : {}),
      ...(contract.tags ? { tags: contract.tags } : {}),
      ...(contract.parameters ? { parameters: contract.parameters } : {}),
      ...(contract.request
        ? {
            requestBody: {
              required: contract.request.required,
              content: contentDocument(contract.request),
            },
          }
        : {}),
      responses,
      ...(contract.security ? { security: contract.security } : {}),
      'x-metakip-docs-slug': routeSlug,
      'x-required-scopes': contract.requiredScopes,
    };
    const path = paths[contract.openApiPath] ?? {};
    path[contract.method] = operation;
    paths[contract.openApiPath] = path;
  }
  return paths;
}

export const uuidPathParameter = (name: string): Readonly<Record<string, unknown>> => ({
  name,
  in: 'path',
  required: true,
  description: `The UUID of the ${name.endsWith('Id') ? name.slice(0, -2) : name}.`,
  schema: { type: 'string', format: 'uuid' },
});

export const jsonContent = (schema: z.ZodType): SchemaContent => ({
  mediaType: 'application/json',
  schema,
});

export const markdownContent = (schema: z.ZodType): SchemaContent => ({
  mediaType: 'text/markdown',
  schema,
});

export const multipartContent = (schema: z.ZodType): SchemaContent => ({
  mediaType: 'multipart/form-data',
  schema,
});

export const zipContent = (schema: z.ZodType): SchemaContent => ({
  mediaType: 'application/zip',
  schema,
});
