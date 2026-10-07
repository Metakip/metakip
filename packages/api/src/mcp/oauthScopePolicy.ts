/**
 * Bound and validate OAuth request bodies before delegating to Better Auth.
 */

type AuthHandler = (request: Request) => Promise<Response>;

export const MCP_OAUTH_MAX_REQUEST_BODY_BYTES = 64 * 1024;

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

async function validateBody(request: Request): Promise<Response | undefined> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  const bodyText = await readBoundedBody(request);
  if (bodyText instanceof Response) return bodyText;
  if (contentType.includes('application/json')) {
    try {
      JSON.parse(bodyText);
    } catch {
      return invalidJsonResponse();
    }
  }
  return undefined;
}

export function createMcpOAuthRequestGuard(authHandler: AuthHandler): {
  authorize: (request: Request) => Promise<Response>;
  consent: (request: Request) => Promise<Response>;
} {
  return {
    async authorize(request) {
      if (request.method === 'POST') {
        const error = await validateBody(request);
        if (error) return error;
      }
      return authHandler(request);
    },
    async consent(request) {
      const error = await validateBody(request);
      if (error) return error;
      return authHandler(request);
    },
  };
}
