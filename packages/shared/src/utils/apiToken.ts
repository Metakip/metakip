export const API_TOKEN_PREFIX = 'mdn';
export const API_TOKEN_SCOPES = ['pages:read', 'pages:comment', 'pages:write'] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export function hasApiTokenScope(
  grantedScopes: Iterable<string>,
  requiredScope: ApiTokenScope,
): boolean {
  const scopes = new Set(grantedScopes);
  if (scopes.has(requiredScope)) return true;
  if (requiredScope === 'pages:read') {
    return scopes.has('pages:comment') || scopes.has('pages:write');
  }
  return requiredScope === 'pages:comment' && scopes.has('pages:write');
}

const API_TOKEN_PATTERN = /^mdn_([0-9a-f]{32})_[A-Za-z0-9_-]{43}$/;

export function parseApiTokenId(token: string): string | null {
  const compactId = token.match(API_TOKEN_PATTERN)?.[1];
  if (!compactId) return null;
  return [
    compactId.slice(0, 8),
    compactId.slice(8, 12),
    compactId.slice(12, 16),
    compactId.slice(16, 20),
    compactId.slice(20),
  ].join('-');
}

export function isApiTokenScope(value: unknown): value is ApiTokenScope {
  return typeof value === 'string' && API_TOKEN_SCOPES.includes(value as ApiTokenScope);
}
