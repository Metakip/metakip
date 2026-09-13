import { hasMcpWriteWithoutRead, MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@metakip/shared';

const INVALID_MCP_SCOPE_SENTINEL = 'metakip:invalid-pages-scope-combination';

/**
 * Better Auth does not expose a requested-scope validation callback, while its
 * provider-owned invalid_scope redirect also validates the client redirect
 * URI. Keep this compatibility adapter narrow: it only detects the product
 * policy violation, translates the request encoding, and delegates redirect
 * construction and client validation back to Better Auth. Remove it when the
 * pinned Better Auth version exposes a requested-scope validation hook.
 */

type AuthHandler = (request: Request) => Promise<Response>;

export const MCP_OAUTH_MAX_REQUEST_BODY_BYTES = 64 * 1024;

function hasInvalidMcpScope(scope: string | undefined): boolean {
  if (!scope) return false;
  return hasMcpWriteWithoutRead(scope.split(/\s+/).filter(Boolean));
}

function invalidConsentScopeResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'invalid_scope',
      error_description: `${MCP_WRITE_SCOPE} requires ${MCP_READ_SCOPE}`,
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );
}

function invalidJsonResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'invalid_request',
      error_description: 'Request body must be valid JSON',
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );
}

export function oversizedOAuthRequestResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'invalid_request',
      error_description: 'Request body is too large',
    }),
    { status: 413, headers: { 'Content-Type': 'application/json' } },
  );
}

function invalidBodyResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'invalid_request',
      error_description: 'Request body must be valid UTF-8',
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );
}

function isBodyLimitError(error: unknown): boolean {
  return error instanceof Error && error.name === 'BodyLimitError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readQueryScopes(request: Request): string[] {
  return new URL(request.url).searchParams.getAll('scope');
}

type ParsedOAuthBody =
  | { kind: 'json'; value: Record<string, unknown> | undefined; scopes: string[] }
  | { kind: 'form'; value: URLSearchParams; scopes: string[] }
  | { kind: 'other'; scopes: [] };

async function readBoundedBody(request: Request): Promise<string | Response> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) return invalidBodyResponse();
    if (parsedLength > MCP_OAUTH_MAX_REQUEST_BODY_BYTES) {
      return oversizedOAuthRequestResponse();
    }
  }

  const body = request.clone().body;
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MCP_OAUTH_MAX_REQUEST_BODY_BYTES) {
        void reader.cancel();
        return oversizedOAuthRequestResponse();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (isBodyLimitError(error)) return oversizedOAuthRequestResponse();
    throw error;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalidBodyResponse();
  }
}

async function readBodyParameters(request: Request): Promise<ParsedOAuthBody | Response> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  const bodyText = await readBoundedBody(request);
  if (bodyText instanceof Response) return bodyText;
  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return invalidJsonResponse();
    }
    return {
      kind: 'json',
      value: isRecord(body) ? body : undefined,
      scopes: isRecord(body) && typeof body.scope === 'string' ? [body.scope] : [],
    };
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const body = new URLSearchParams(bodyText);
    return { kind: 'form', value: body, scopes: body.getAll('scope') };
  }
  return { kind: 'other', scopes: [] };
}

function addInvalidScopeSentinel(scope: string): string {
  return [...new Set([...scope.split(/\s+/).filter(Boolean), INVALID_MCP_SCOPE_SENTINEL])].join(
    ' ',
  );
}

async function requestWithInvalidAuthorizeScope(
  request: Request,
  scope: string,
  bodyParameters: ParsedOAuthBody | undefined,
): Promise<Request | Response> {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  const url = new URL(request.url);
  const query = url.searchParams;
  const hasQueryScope = query.has('scope');
  if (request.method === 'GET' || hasQueryScope) {
    url.searchParams.set('scope', addInvalidScopeSentinel(scope));
    if (request.method === 'GET') return new Request(url, { method: request.method, headers });
  }

  if (bodyParameters?.kind === 'json' && bodyParameters.value !== undefined) {
    return new Request(url, {
      method: request.method,
      headers,
      body: JSON.stringify({
        ...bodyParameters.value,
        scope: addInvalidScopeSentinel(scope),
      }),
    });
  }
  if (bodyParameters?.kind === 'form') {
    const body = new URLSearchParams(bodyParameters.value);
    body.set('scope', addInvalidScopeSentinel(scope));
    return new Request(url, {
      method: request.method,
      headers,
      body: body.toString(),
    });
  }
  return invalidConsentScopeResponse();
}

export function createMcpOAuthScopePolicy(authHandler: AuthHandler): {
  authorize: (request: Request) => Promise<Response>;
  consent: (request: Request) => Promise<Response>;
} {
  return {
    async authorize(request) {
      const queryScopes = readQueryScopes(request);
      const bodyParameters =
        request.method === 'POST' ? await readBodyParameters(request) : undefined;
      if (bodyParameters instanceof Response) return bodyParameters;
      const scopeValues = [...queryScopes, ...(bodyParameters?.scopes ?? [])];
      const invalidScope = scopeValues.find(hasInvalidMcpScope);
      if (!invalidScope && !hasInvalidMcpScope(scopeValues.join(' '))) {
        return authHandler(request);
      }

      // Better Auth owns registered-redirect validation and RFC OAuth error
      // redirects. The sentinel makes its canonical endpoint produce the
      // redirect rather than a local JSON response. Apply it to every
      // location from which scope was supplied so query/body precedence cannot
      // bypass the policy.
      const rewrittenRequest = await requestWithInvalidAuthorizeScope(
        request,
        scopeValues.join(' '),
        bodyParameters,
      );
      return rewrittenRequest instanceof Response
        ? rewrittenRequest
        : authHandler(rewrittenRequest);
    },
    async consent(request) {
      const queryScopes = readQueryScopes(request);
      const bodyParameters = await readBodyParameters(request);
      if (bodyParameters instanceof Response) return bodyParameters;
      const scopeValues = [...queryScopes, ...bodyParameters.scopes];
      if (scopeValues.some(hasInvalidMcpScope) || hasInvalidMcpScope(scopeValues.join(' '))) {
        return invalidConsentScopeResponse();
      }
      return authHandler(request);
    },
  };
}
