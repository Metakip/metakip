import { getAppLogger, parseMcpApiUrl } from '@metakip/shared';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

export const MCP_PROXY_MAX_BODY_BYTES = 64 * 1024;
const MCP_API_PROXY_TIMEOUT_MS = 30_000;

export const mcpProxyBodyLimit = bodyLimit({
  maxSize: MCP_PROXY_MAX_BODY_BYTES,
  onError: (c) =>
    c.json(
      { error: { code: 'payload_too_large', message: 'MCP proxy request body is too large' } },
      413,
    ),
});

export function apiOrigin(configured: string): URL {
  return parseMcpApiUrl(configured);
}

export async function proxyToApi(
  c: Context,
  origin: URL,
  fetcher: typeof fetch,
  pathPrefix: string,
): Promise<Response> {
  const incoming = new URL(c.req.url);
  const target = new URL(`${pathPrefix}${incoming.pathname}${incoming.search}`, origin);
  const headers = new Headers(c.req.raw.headers);
  headers.delete('host');
  headers.delete('content-length');
  const init: RequestInit = {
    method: c.req.method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(MCP_API_PROXY_TIMEOUT_MS),
  };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = new Uint8Array(await c.req.arrayBuffer());
  }
  try {
    const response = await fetcher(target, init);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    // The proxy is a service boundary: upstream network and timeout failures
    // become a retryable 503 instead of hanging the MCP connection.
    getAppLogger().error('MCP API proxy request failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json(
      {
        error: {
          code: 'service_unavailable',
          message: 'Metakip API is temporarily unavailable',
        },
      },
      503,
    );
  }
}
