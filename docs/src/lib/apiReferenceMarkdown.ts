import openapiDocument from '../../openapi.json';

type JsonObject = Record<string, unknown>;

export interface ApiReferenceMarkdownEntry {
  body: string;
  slug: string;
}

interface ApiOperation {
  data: JsonObject;
  method: string;
  path: string;
  routeSlug: string;
  tags: string[];
}

export interface ApiReferencePageMetadata {
  description: string;
  kind: 'overview' | 'tag' | 'operation';
  method?: string;
  path?: string;
  title: string;
}

const API_BASE_SLUG = 'api-reference/endpoints';
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const document = openapiDocument as unknown as JsonObject;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function requiredScopes(value: unknown, operationLabel: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`OpenAPI operation ${operationLabel} is missing x-required-scopes metadata.`);
  }
  if (!value.every((scope): scope is string => typeof scope === 'string')) {
    throw new Error(`OpenAPI operation ${operationLabel} has invalid x-required-scopes metadata.`);
  }
  return value;
}

function normalizePathname(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, '');
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null';
}

function resolveSchema(schema: unknown): unknown {
  const schemaObject = asObject(schema);
  const reference = asString(schemaObject?.$ref);
  if (!reference) return schema;
  if (!reference.startsWith('#/')) {
    throw new Error(`Unsupported OpenAPI schema reference: ${reference}`);
  }

  let current: unknown = document;
  for (const segment of reference.slice(2).split('/')) {
    const object = asObject(current);
    if (!object) throw new Error(`Unable to resolve OpenAPI schema reference: ${reference}`);
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    current = object[key];
  }
  if (current === undefined) {
    throw new Error(`Unable to resolve OpenAPI schema reference: ${reference}`);
  }
  return current;
}

function schemaExample(schema: unknown): unknown {
  const schemaObject = asObject(resolveSchema(schema));
  if (!schemaObject) return null;
  if ('example' in schemaObject) return schemaObject.example;

  const examples = schemaObject.examples;
  if (Array.isArray(examples) && examples.length > 0) return examples[0];

  const anyOf = schemaObject.anyOf;
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const nonNullSchema = anyOf.find((item) => asObject(item)?.type !== 'null');
    return schemaExample(nonNullSchema ?? anyOf[0]);
  }

  switch (schemaObject.type) {
    case 'array':
      return [schemaExample(schemaObject.items)];
    case 'boolean':
      return false;
    case 'integer':
    case 'number':
      return 0;
    case 'null':
      return null;
    case 'object': {
      const properties = asObject(schemaObject.properties);
      if (!properties) return {};
      return Object.fromEntries(
        Object.entries(properties).map(([name, property]) => [name, schemaExample(property)]),
      );
    }
    case 'string': {
      const enumValues = Array.isArray(schemaObject.enum) ? schemaObject.enum : [];
      if (enumValues.length > 0) return enumValues[0];
      if (schemaObject.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
      return 'string';
    }
    default:
      return null;
  }
}

function renderMediaType(mediaType: string, media: unknown): string[] {
  const mediaObject = asObject(media);
  const schema = mediaObject?.schema;
  if (!schema && !mediaObject?.example) return [`- \`${mediaType}\``];

  const example = mediaObject?.example ?? schemaExample(schema);
  const language = mediaType.includes('json') ? 'json' : 'text';
  return [`### \`${mediaType}\``, '', `\`\`\`${language}`, stringify(example), '```'];
}

function renderRequestBody(requestBody: unknown): string[] {
  const request = asObject(requestBody);
  const content = asObject(request?.content);
  if (!content) return [];

  const lines = ['## Request Body', '', request?.required === true ? 'Required.' : 'Optional.'];
  for (const [mediaType, media] of Object.entries(content)) {
    lines.push('', ...renderMediaType(mediaType, media));
  }
  return lines;
}

function renderParameters(parameters: unknown): string[] {
  if (!Array.isArray(parameters) || parameters.length === 0) return [];

  const lines = ['## Parameters', ''];
  for (const parameter of parameters) {
    const item = asObject(parameter);
    if (!item) continue;
    const name = asString(item.name) ?? 'parameter';
    const location = asString(item.in) ?? 'unknown';
    const requirement = item.required === true ? 'required' : 'optional';
    const description = asString(item.description);
    lines.push(
      `- \`${name}\` (${location}, ${requirement})${description ? `: ${description}` : ''}`,
    );
  }
  return lines.length > 2 ? lines : [];
}

function renderResponseHeaders(headers: unknown): string[] {
  if (headers === undefined) return [];

  const headerMap = asObject(headers);
  if (!headerMap) throw new Error('OpenAPI response headers must be an object.');

  const lines = ['#### Response headers', ''];
  for (const [name, header] of Object.entries(headerMap)) {
    const headerObject = asObject(header);
    if (!headerObject) {
      throw new Error(`OpenAPI response header "${name}" must be an object.`);
    }

    const description = asString(headerObject.description);
    const schema = asObject(headerObject.schema);
    const type = asString(schema?.type);
    const required = headerObject.required === true ? ' (required)' : '';
    const details = [description, type ? `Type: \`${type}\`.` : undefined].filter(
      (value): value is string => Boolean(value),
    );
    lines.push(`- \`${name}\`${required}${details.length > 0 ? `: ${details.join(' ')}` : ''}`);
  }

  return lines.length > 2 ? lines : [];
}

function readSecurityRequirements(value: unknown, source: string): JsonObject[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`OpenAPI ${source} security value must be an array.`);
  }

  return value.map((requirement, index) => {
    const requirementObject = asObject(requirement);
    if (!requirementObject) {
      throw new Error(`OpenAPI ${source} security requirement ${index} must be an object.`);
    }
    return requirementObject;
  });
}

function securitySchemeLabel(schemeName: string, scheme: JsonObject): string {
  if (schemeName === 'bearerToken') return 'API token';
  if (schemeName === 'browserSession') return 'Better Auth browser session';
  return asString(scheme.name) ?? schemeName;
}

function securitySchemeTransport(scheme: JsonObject): string | undefined {
  const type = asString(scheme.type);
  const schemeName = asString(scheme.scheme);
  if (type === 'http' && schemeName === 'bearer') {
    return 'Send it in the `Authorization: Bearer <token>` header.';
  }

  if (type === 'apiKey') {
    const name = asString(scheme.name);
    const location = asString(scheme.in);
    if (name && location) return `Send it in the \`${name}\` ${location}.`;
  }

  return undefined;
}

function renderSecurityScheme(schemeName: string, scheme: JsonObject): string {
  const description = asString(scheme.description);
  const transport = securitySchemeTransport(scheme);
  const details = [description, transport].filter((value): value is string => Boolean(value));
  if (details.length === 0) {
    throw new Error(`OpenAPI security scheme "${schemeName}" has no usable description.`);
  }

  return `**${securitySchemeLabel(schemeName, scheme)}** (\`${schemeName}\`) : ${details.join(' ')}`;
}

function renderAuthentication(operation: ApiOperation): string[] {
  const operationSecurity = readSecurityRequirements(
    operation.data.security,
    `operation ${operation.method.toUpperCase()} ${operation.path}`,
  );
  const security =
    operationSecurity ?? readSecurityRequirements(document.security, 'document') ?? [];

  if (
    security.length === 0 ||
    security.every((requirement) => Object.keys(requirement).length === 0)
  ) {
    return ['## Authentication', '', 'This endpoint does not require authentication.'];
  }

  const components = asObject(document.components);
  const securitySchemes = asObject(components?.securitySchemes);
  if (!securitySchemes) {
    throw new Error('OpenAPI document is missing components.securitySchemes.');
  }

  const alternatives = security.map((requirement, index) => {
    const schemes = Object.keys(requirement).map((schemeName) => {
      const scheme = asObject(securitySchemes[schemeName]);
      if (!scheme) {
        throw new Error(
          `OpenAPI security requirement ${index} references missing scheme "${schemeName}".`,
        );
      }
      return renderSecurityScheme(schemeName, scheme);
    });
    if (schemes.length === 0) {
      throw new Error(`OpenAPI security requirement ${index} has no authentication scheme.`);
    }
    return schemes;
  });

  if (alternatives.length === 1 && alternatives[0]?.length === 1) {
    return [
      '## Authentication',
      '',
      'Use the following authentication method:',
      '',
      `- ${alternatives[0][0]}`,
    ];
  }

  if (alternatives.length === 1) {
    return [
      '## Authentication',
      '',
      'Provide all of the following authentication methods:',
      '',
      ...alternatives[0].map((scheme) => `- ${scheme}`),
    ];
  }

  const lines = [
    '## Authentication',
    '',
    'Use one of the following authentication alternatives:',
    '',
  ];
  for (const [index, alternative] of alternatives.entries()) {
    if (alternative.length === 1) {
      lines.push(`- ${alternative[0]}`);
      continue;
    }
    lines.push(
      `- **Alternative ${index + 1}:** provide all of the following:`,
      ...alternative.map((scheme) => `  - ${scheme}`),
    );
  }
  return lines;
}

function renderPermissions(operation: ApiOperation): string[] {
  const label = `${operation.method.toUpperCase()} ${operation.path}`;
  const scopes = requiredScopes(operation.data['x-required-scopes'], label);
  if (scopes.length === 0) return [];

  return [
    '## Token permissions',
    '',
    `API tokens must include ${scopes.map((scope) => `\`${scope}\``).join(' and ')}.`,
  ];
}

function renderResponses(responses: unknown): string[] {
  const responseMap = asObject(responses);
  if (!responseMap) return [];

  const lines = ['## Responses', ''];
  for (const [status, response] of Object.entries(responseMap)) {
    const responseObject = asObject(response);
    lines.push(`### ${status}`);
    if (responseObject?.description) lines.push('', String(responseObject.description));
    lines.push('', ...renderResponseHeaders(responseObject?.headers));

    const content = asObject(responseObject?.content);
    if (!content) {
      lines.push('');
      continue;
    }

    for (const [mediaType, media] of Object.entries(content)) {
      lines.push('', ...renderMediaType(mediaType, media));
    }
    lines.push('');
  }
  return lines;
}

function getOperations(): ApiOperation[] {
  const paths = asObject(document.paths);
  if (!paths) return [];

  const operations: ApiOperation[] = [];
  for (const [path, pathItemValue] of Object.entries(paths)) {
    const pathItem = asObject(pathItemValue);
    if (!pathItem) continue;

    const methods = HTTP_METHODS.flatMap((method) => {
      const data = asObject(pathItem[method]);
      return data ? [{ data, method }] : [];
    });
    methods.forEach(({ data, method }) => {
      const docsSlug = asString(data['x-metakip-docs-slug']);
      if (!docsSlug) {
        throw new Error(
          `OpenAPI operation ${method.toUpperCase()} ${path} is missing x-metakip-docs-slug metadata.`,
        );
      }
      operations.push({
        data,
        method,
        path,
        routeSlug: `${API_BASE_SLUG}/operations/${docsSlug}`,
        tags: asStringArray(data.tags),
      });
    });
  }
  return operations;
}

const apiOperations = getOperations();

function metaDescription(value: string, fallback: string): string {
  const description = value.replace(/\s+/g, ' ').trim() || fallback;
  if (description.length <= 155) return description;
  const cutoff = description.slice(0, 152).lastIndexOf(' ');
  return `${description.slice(0, cutoff > 0 ? cutoff : 152)}...`;
}

export function getApiReferencePageMetadata(
  pathname: string,
): ApiReferencePageMetadata | undefined {
  const sluggedPathname = normalizePathname(pathname);
  if (sluggedPathname === API_BASE_SLUG) {
    return {
      kind: 'overview',
      title: 'Metakip API Reference | Metakip Docs',
      description: metaDescription(
        asString(asObject(document.info)?.description) ?? '',
        'Read and change Metakip pages, folders, and markdown through the API.',
      ),
    };
  }

  const tag = (Array.isArray(document.tags) ? document.tags : []).map(asObject).find((item) => {
    const tagSlug = asString(item?.['x-metakip-docs-slug']);
    return tagSlug && `${API_BASE_SLUG}/operations/tags/${tagSlug}` === sluggedPathname;
  });
  if (tag) {
    const tagName = asString(tag.name) ?? 'API';
    return {
      kind: 'tag',
      title: `${tagName} API Reference | Metakip Docs`,
      description: metaDescription(
        `${tagName} endpoints in the Metakip API. ${asString(tag.description) ?? ''}`,
        `Use the ${tagName} endpoints in the Metakip API.`,
      ),
    };
  }

  const operation = apiOperations.find((item) => item.routeSlug === sluggedPathname);
  if (!operation) return undefined;

  const title =
    asString(operation.data.summary) ?? `${operation.method.toUpperCase()} ${operation.path}`;
  return {
    kind: 'operation',
    title: `${title} API | Metakip Docs`,
    description: metaDescription(
      `${operation.method.toUpperCase()} ${operation.path}. ${asString(operation.data.description) ?? ''}`,
      `Use the Metakip API to ${title.toLowerCase()}.`,
    ),
    method: operation.method.toUpperCase(),
    path: operation.path,
  };
}

function renderOperation(operation: ApiOperation): string {
  const title =
    asString(operation.data.summary) ?? `${operation.method.toUpperCase()} ${operation.path}`;
  const lines = [`# ${title}`, '', `\`${operation.method.toUpperCase()} ${operation.path}\``];
  const description = asString(operation.data.description);
  if (description) lines.push('', description);

  lines.push(...renderAuthentication(operation));
  lines.push(...renderPermissions(operation));
  lines.push(...renderParameters(operation.data.parameters));
  lines.push(...renderRequestBody(operation.data.requestBody));
  lines.push(...renderResponses(operation.data.responses));
  return `${lines.join('\n').trim()}\n`;
}

function renderOverview(): string {
  const info = asObject(document.info);
  const lines = ['# Metakip API Reference', ''];
  const description = asString(info?.description);
  if (description) lines.push(description, '');
  lines.push(
    'The API is available at `https://app.metakip.com/api/v1` and supports bearer tokens and browser sessions.',
    '',
    '## Quick Start',
    '',
    'Create a named API token in Metakip Settings, store it in `METAKIP_TOKEN`, and send it as a bearer token:',
    '',
    '```bash',
    'curl https://app.metakip.com/api/v1/pages \\',
    '  -H "Authorization: Bearer $METAKIP_TOKEN"',
    '```',
    '',
    'Use the [Metakip CLI](/agents/metakip-cli/) when you want a terminal workflow instead of making HTTP requests directly.',
    '',
    '## Endpoint Groups',
    '',
  );

  const tags = Array.isArray(document.tags) ? document.tags : [];
  for (const tag of tags) {
    const item = asObject(tag);
    const name = asString(item?.name);
    if (!name) continue;
    const descriptionText = asString(item?.description);
    lines.push(`- **${name}**${descriptionText ? `: ${descriptionText}` : ''}`);
  }
  return `${lines.join('\n').trim()}\n`;
}

function renderTag(tagName: string, operations: ApiOperation[]): string {
  const tag = (Array.isArray(document.tags) ? document.tags : [])
    .map(asObject)
    .find((item) => asString(item?.name) === tagName);
  const lines = [`# ${tagName}`, ''];
  const description = asString(tag?.description);
  if (description) lines.push(description, '');
  lines.push('## Endpoints', '');
  for (const operation of operations) {
    const title = asString(operation.data.summary) ?? operation.method.toUpperCase();
    lines.push(`- \`${operation.method.toUpperCase()} ${operation.path}\`: ${title}`);
  }
  return `${lines.join('\n').trim()}\n`;
}

function createEntries(): ApiReferenceMarkdownEntry[] {
  const operations = apiOperations;
  const entries: ApiReferenceMarkdownEntry[] = [{ slug: API_BASE_SLUG, body: renderOverview() }];

  const tags = Array.isArray(document.tags) ? document.tags : [];
  for (const tagValue of tags) {
    const tag = asObject(tagValue);
    const tagName = asString(tag?.name);
    const tagSlug = asString(tag?.['x-metakip-docs-slug']);
    if (!tagName || !tagSlug) {
      throw new Error('OpenAPI tag is missing name or x-metakip-docs-slug metadata.');
    }
    const tagOperations = operations.filter((operation) => operation.tags.includes(tagName));
    entries.push({
      slug: `${API_BASE_SLUG}/operations/tags/${tagSlug}`,
      body: renderTag(tagName, tagOperations),
    });
  }

  for (const operation of operations) {
    entries.push({ slug: operation.routeSlug, body: renderOperation(operation) });
  }
  return entries;
}

const apiReferenceMarkdownEntries = createEntries();

export function getApiReferenceMarkdownEntries(): ApiReferenceMarkdownEntry[] {
  return apiReferenceMarkdownEntries;
}

export function getApiReferenceMarkdown(pathname: string): string | undefined {
  const sluggedPathname = normalizePathname(pathname);
  return apiReferenceMarkdownEntries.find((entry) => entry.slug === sluggedPathname)?.body;
}
