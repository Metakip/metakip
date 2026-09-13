function isIpLiteral(hostname: string): boolean {
  if (hostname.includes(':')) return true;
  const octets = hostname.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/** Default public origin for the hosted Metakip deployment. */
export const MCP_PRODUCTION_PUBLIC_ORIGIN = 'https://mcp.metakip.com';

export function parseMcpApiUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MCP_API_URL must be a valid URL');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('MCP_API_URL must use HTTP or HTTPS and include a hostname');
  }
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      'MCP_API_URL must be an origin only without credentials, path, query, or fragment',
    );
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(hostname)) {
    throw new Error(
      'MCP_API_URL must use HTTPS unless the hostname is localhost, 127.0.0.1, or ::1',
    );
  }
  return parsed;
}

export function parseMcpPublicUrl(value: string, isProduction: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('MCP_PUBLIC_URL must be a valid URL');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) throw new Error('MCP_PUBLIC_URL must include a hostname');
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('MCP_PUBLIC_URL must use HTTP or HTTPS');
  }
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      'MCP_PUBLIC_URL must be an origin only without credentials, path, query, or fragment',
    );
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(hostname)) {
    throw new Error(
      'MCP_PUBLIC_URL must use HTTPS unless the hostname is localhost, 127.0.0.1, or ::1',
    );
  }
  if (
    isProduction &&
    (parsed.protocol !== 'https:' ||
      isIpLiteral(hostname) ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local'))
  ) {
    throw new Error('MCP_PUBLIC_URL must be a public HTTPS URL in production');
  }
  return parsed;
}

export function normalizeMcpPublicOrigin(value: string, isProduction: boolean): URL {
  const parsed = parseMcpPublicUrl(value, isProduction);
  return new URL(`${parsed.protocol}//${parsed.host}`);
}
