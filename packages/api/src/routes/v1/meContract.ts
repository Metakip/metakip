import { API_TOKEN_SCOPES } from '@metakip/shared';
import { z } from 'zod';
import { jsonContent, type V1OperationContract } from './apiContract';

export const getMeOperation = {
  method: 'get',
  routePath: '/',
  openApiPath: '/me',
  summary: 'Get The Current User',
  description:
    "Returns the authenticated user's profile and how the request was authenticated. Token-authenticated responses include the token's scopes; session-authenticated responses set `scopes` to `null`.",
  tags: ['Identity'],
  requiredScopes: [],
  responses: {
    '200': {
      description: 'Current user and authentication context.',
      content: jsonContent(
        z.object({
          id: z.uuid(),
          name: z.string(),
          email: z.string(),
          image: z.string().nullable(),
          authentication: z.enum(['session', 'token', 'mcp']),
          scopes: z.array(z.enum(API_TOKEN_SCOPES)).nullable(),
        }),
      ),
    },
    '401': { description: 'Authentication failed or was not provided.' },
  },
} as const satisfies V1OperationContract;
