import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseMcpPublicUrl,
  requireCollaborationInternalSecret as validateCollaborationInternalSecret,
} from '@metakip/shared';
import { requireMcpApiInternalSecret as validateMcpApiInternalSecret } from '@metakip/shared/node/mcp-internal-auth';
import { config } from 'dotenv';

const currentDir = dirname(fileURLToPath(import.meta.url));

export const uploadsDir = resolve(currentDir, '..', 'uploads');

const candidateEnvPaths = [
  resolve(process.cwd(), '.env'),
  resolve(currentDir, '../.env'),
  resolve(currentDir, '../../../.env'),
];

const selectedEnvPath = candidateEnvPaths.find((envPath) => existsSync(envPath));

if (selectedEnvPath) {
  config({ path: selectedEnvPath });
} else {
  config();
}

export function requireCollaborationInternalSecret(): string {
  return validateCollaborationInternalSecret(process.env.COLLAB_INTERNAL_SECRET);
}

export function requireMcpApiInternalSecret(): string {
  return validateMcpApiInternalSecret(
    process.env.MCP_API_INTERNAL_SECRET,
    process.env.NODE_ENV === 'production',
  );
}

export function requireInvitationTokenEncryptionKey(): string {
  const key = process.env.INVITATION_TOKEN_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error('INVITATION_TOKEN_ENCRYPTION_KEY must be at least 32 characters');
  }
  return key;
}

export function invitationTokenEncryptionKeys(): readonly [string, ...string[]] {
  const current = requireInvitationTokenEncryptionKey();
  const previous = process.env.INVITATION_TOKEN_ENCRYPTION_KEY_PREVIOUS;
  if (previous && previous.length < 32) {
    throw new Error('INVITATION_TOKEN_ENCRYPTION_KEY_PREVIOUS must be at least 32 characters');
  }
  return previous ? [current, previous] : [current];
}

export type InvitationEmailConfiguration = {
  apiKey: string;
  from: string;
};

const DEFAULT_INVITATION_FROM_EMAIL = 'Metakip <invites@notifications.metakip.com>';
const RESEND_API_KEY_PLACEHOLDER = 'your-resend-api-key';

export function invitationEmailConfiguration(): InvitationEmailConfiguration | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey || apiKey === RESEND_API_KEY_PLACEHOLDER) return null;
  return {
    apiKey,
    from: process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_INVITATION_FROM_EMAIL,
  };
}

export function requireInvitationEmailConfiguration(): InvitationEmailConfiguration {
  const configuration = invitationEmailConfiguration();
  if (!configuration) {
    throw new Error('RESEND_API_KEY must be configured for invitation delivery');
  }
  return configuration;
}

export function requireMcpPublicUrl(): string {
  const configured = process.env.MCP_PUBLIC_URL;
  if (!configured) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MCP_PUBLIC_URL is required in production');
    }
    return 'http://localhost:3002';
  }

  parseMcpPublicUrl(configured, process.env.NODE_ENV === 'production');
  return configured;
}

export function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173';
}

export function betterAuthIssuer(): string {
  return (
    process.env.BETTER_AUTH_ISSUER ??
    new URL('/api/auth', `${frontendUrl().replace(/\/$/, '')}/`).toString().replace(/\/$/, '')
  );
}

export function mcpResource(): string {
  return new URL('/mcp', `${requireMcpPublicUrl().replace(/\/$/, '')}/`).toString();
}

export function betterAuthJwksUrl(): string {
  const apiUrl = process.env.API_INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`;
  return (
    process.env.BETTER_AUTH_JWKS_URL ??
    new URL('/api/auth/jwks', `${apiUrl.replace(/\/$/, '')}/`).toString()
  );
}
