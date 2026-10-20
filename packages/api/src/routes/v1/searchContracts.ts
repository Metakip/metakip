import { v1SearchResponseSchema, v1SearchResultSchema } from '@metakip/shared';
import { jsonContent, type V1OperationContract } from './apiContract';

export const searchResultSchema = v1SearchResultSchema;
export const searchResponseSchema = v1SearchResponseSchema;

export const searchOperation = {
  method: 'get',
  routePath: '/',
  openApiPath: '/search',
  summary: 'Search Pages And Folders',
  description:
    'Searches accessible, non-deleted pages and folders by title and page body text. Results are ordered by relevance and limited to 20; body matches include a highlighted excerpt.',
  tags: ['Search'],
  requiredScopes: ['pages:read'],
  parameters: [
    {
      name: 'q',
      in: 'query',
      description: 'Text to search for. Blank or omitted queries return no results.',
      schema: { type: 'string' },
    },
  ],
  responses: {
    '200': {
      description: 'Accessible pages and folders matching the query.',
      content: jsonContent(searchResponseSchema),
    },
  },
} as const satisfies V1OperationContract;
