import { describe, expect, it } from 'vitest';
import { openApiV1 } from './openapi';

describe('v1 OpenAPI lifecycle contract', () => {
  it('documents resource-oriented lifecycle, Trash, import, and export operations', () => {
    const paths = openApiV1.paths;

    expect(paths['/pages/{pageId}/copy']?.post).toBeDefined();
    expect(paths['/folders/{folderId}/copy']?.post).toBeDefined();
    expect(paths['/folders/{folderId}']?.patch).toBeDefined();
    expect(paths['/trash/empty']?.delete).toBeDefined();
    expect(paths['/imports/markdown']?.post).toBeDefined();
    expect(paths['/imports/obsidian']?.post).toBeDefined();
    expect(paths['/pages/{pageId}/export/markdown']?.get).toBeDefined();
    expect(paths['/exports/workspace']?.get).toBeDefined();
    expect(paths['/pages/search']?.get).toBeDefined();

    const pageExport = paths['/pages/{pageId}/export/markdown']?.get as {
      responses: { 200: { content: Record<string, unknown> } };
    };
    expect(pageExport.responses[200]?.content).toHaveProperty('text/markdown');
    expect(pageExport.responses[200]?.content).toHaveProperty('application/zip');
    expect(pageExport.responses[200].content['application/zip']).toMatchObject({
      schema: { type: 'string', format: 'binary' },
    });

    const exportAll = paths['/exports/workspace']?.get as {
      responses: { 200: { content: Record<string, unknown> } };
    };
    expect(exportAll.responses[200]?.content).toHaveProperty('application/zip');
    expect(exportAll.responses[200].content['application/zip']).toMatchObject({
      schema: { type: 'string', format: 'binary' },
    });

    const movedPage = paths['/pages/{pageId}/move']?.patch as {
      responses: {
        200: {
          content: { 'application/json': { schema: { properties: Record<string, unknown> } } };
        };
      };
    };
    expect(
      Object.keys(movedPage.responses[200].content['application/json'].schema.properties),
    ).toEqual(['id']);

    const copiedFolder = paths['/folders/{folderId}/copy']?.post as {
      responses: {
        201: {
          content: { 'application/json': { schema: { properties: Record<string, unknown> } } };
        };
      };
    };
    expect(
      Object.keys(copiedFolder.responses[201].content['application/json'].schema.properties).sort(),
    ).toEqual(['id', 'skippedRestrictedItems']);

    const markdownImport = paths['/imports/markdown']?.post as {
      requestBody: {
        required: boolean;
        content: {
          'multipart/form-data': {
            schema: {
              properties: { file: { format: string } };
              required: string[];
            };
          };
        };
      };
    };
    expect(markdownImport.requestBody.required).toBe(true);
    expect(markdownImport.requestBody.content['multipart/form-data'].schema.required).toEqual([
      'file',
    ]);
    expect(
      markdownImport.requestBody.content['multipart/form-data'].schema.properties.file.format,
    ).toBe('binary');

    const vaultImport = paths['/imports/obsidian']?.post as {
      requestBody: {
        content: {
          'application/json': {
            schema: { properties: { files: { minItems: number } } };
          };
        };
      };
    };
    expect(
      vaultImport.requestBody.content['application/json'].schema.properties.files.minItems,
    ).toBe(1);

    const folderUpdate = paths['/folders/{folderId}']?.patch as {
      requestBody: { content: { 'application/json': { schema: { anyOf: unknown[] } } } };
    };
    expect(folderUpdate.requestBody.content['application/json'].schema.anyOf).toHaveLength(2);

    const listPages = paths['/pages']?.get as {
      'x-metakip-docs-slug': string;
      'x-required-scopes': string[];
      responses: Record<string, { description: string }>;
    };
    expect(listPages['x-metakip-docs-slug']).toBe('pages-get');
    expect(listPages['x-required-scopes']).toEqual(['pages:read']);
    expect(listPages.responses['403']?.description).toContain('pages:read');

    const pageMetadata = paths['/pages/{pageId}']?.get as {
      'x-metakip-docs-slug': string;
    };
    expect(pageMetadata['x-metakip-docs-slug']).toBe('pages-page-id-get');

    const pageSearch = paths['/pages/search']?.get as {
      'x-required-scopes': string[];
      parameters: Array<{ name: string; in: string }>;
    };
    expect(pageSearch['x-required-scopes']).toEqual(['pages:read']);
    expect(pageSearch.parameters).toContainEqual(
      expect.objectContaining({ name: 'q', in: 'query' }),
    );

    const listTokens = paths['/tokens']?.get as {
      'x-required-scopes': string[];
      responses: Record<string, unknown>;
    };
    expect(listTokens['x-required-scopes']).toEqual([]);
    expect(listTokens.responses['403']).toBeUndefined();
  });
});
