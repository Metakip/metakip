import { API_TOKEN_SCOPES } from '@metakip/shared';
import { z } from 'zod';
import { jsonContent, uuidPathParameter, type V1OperationContract } from './apiContract';

export const createTokenRequestSchema = z
  .object({
    name: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1).max(100)),
    scopes: z.array(z.enum(API_TOKEN_SCOPES)).min(1).optional(),
    expiresAt: z.string().nullable().optional(),
  })
  .meta({
    example: {
      name: 'Local CLI',
      scopes: ['pages:read'],
      expiresAt: null,
    },
  });

export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});
const apiTokensTag = ['API Tokens'] as const;

export const tokenOperations = {
  list: {
    method: 'get',
    routePath: '/',
    openApiPath: '/tokens',
    summary: 'List API Tokens',
    description: "Lists the caller's active API tokens without revealing their secrets.",
    tags: apiTokensTag,
    requiredScopes: [],
    security: [{ browserSession: [] }],
    responses: {
      '200': {
        description: 'Active API tokens without secrets.',
        content: jsonContent(z.object({ data: z.array(apiTokenSchema) })),
      },
    },
  },
  create: {
    method: 'post',
    routePath: '/',
    openApiPath: '/tokens',
    summary: 'Create An API Token',
    description:
      'Creates an API token through a browser session. The token secret appears only in this response. If `scopes` is omitted, the token starts with `pages:read`.',
    tags: apiTokensTag,
    requiredScopes: [],
    security: [{ browserSession: [] }],
    request: { required: true, ...jsonContent(createTokenRequestSchema) },
    responses: {
      '201': {
        description: 'Token metadata and the secret, which is shown only once.',
        content: jsonContent(apiTokenSchema.extend({ token: z.string() })),
      },
    },
  },
  revoke: {
    method: 'delete',
    routePath: '/:id',
    openApiPath: '/tokens/{tokenId}',
    summary: 'Revoke An API Token',
    description:
      'Revokes an API token owned by the authenticated user. Revocation cannot be undone.',
    tags: apiTokensTag,
    requiredScopes: [],
    security: [{ browserSession: [] }],
    parameters: [uuidPathParameter('tokenId')],
    responses: { '204': { description: 'The token was revoked.' } },
  },
} as const satisfies Record<string, V1OperationContract>;
