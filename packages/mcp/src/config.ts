import { normalizeMcpPublicOrigin, parseMcpApiUrl } from '@metakip/shared';
import { requireMcpApiInternalSecret } from '@metakip/shared/node/mcp-internal-auth';

export type McpRuntimeConfig = {
  apiUrl: string;
  publicUrl: URL;
  authIssuer: string;
  authJwksUrl: string;
  apiInternalSecret: string;
  port: number;
};

export function getMcpRuntimeConfig(env: NodeJS.ProcessEnv = process.env): McpRuntimeConfig {
  const isProduction = env.NODE_ENV === 'production';
  const configuredPublicUrl = env.MCP_PUBLIC_URL ?? 'http://localhost:3002';
  if (isProduction && !env.MCP_PUBLIC_URL) {
    throw new Error('MCP_PUBLIC_URL is required in production');
  }
  const publicUrl = normalizeMcpPublicOrigin(configuredPublicUrl, isProduction);
  const apiUrl = env.MCP_API_URL ?? 'http://127.0.0.1:3001';
  parseMcpApiUrl(apiUrl);

  const port = Number(env.MCP_PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('MCP_PORT must be an integer between 1 and 65535');
  }

  const frontendUrl = env.FRONTEND_URL ?? 'http://localhost:5173';
  const authIssuer =
    env.BETTER_AUTH_ISSUER ??
    new URL('/api/auth', `${frontendUrl.replace(/\/$/, '')}/`).toString().replace(/\/$/, '');
  const authJwksUrl =
    env.BETTER_AUTH_JWKS_URL ??
    new URL('/api/auth/jwks', `${apiUrl.replace(/\/$/, '')}/`).toString();
  const apiInternalSecret = requireMcpApiInternalSecret(env.MCP_API_INTERNAL_SECRET, isProduction);

  return {
    apiUrl,
    publicUrl,
    authIssuer,
    authJwksUrl,
    apiInternalSecret,
    port,
  };
}
