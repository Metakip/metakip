import { sessionIdempotencyPrincipal } from '@metakip/shared/node/api-token-credential';

export { mcpConnectionIdFromClaims } from '@metakip/shared/node/mcp-internal-auth';

export function mcpIdempotencyPrincipal(connectionId: string): string {
  return sessionIdempotencyPrincipal(`mcp:${connectionId}`);
}
