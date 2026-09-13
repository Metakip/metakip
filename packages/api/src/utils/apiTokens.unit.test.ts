import { parseApiTokenId } from '@metakip/shared';
import { hashApiToken } from '@metakip/shared/node/api-token-credential';
import { describe, expect, it } from 'vitest';
import { createApiTokenSecret } from './apiTokens';

describe('API token secrets', () => {
  it('encodes a lookup ID without storing the recoverable secret', () => {
    const created = createApiTokenSecret();
    expect(created.token).toMatch(/^mdn_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    expect(parseApiTokenId(created.token)).toBe(created.id);
    expect(created.tokenHash).toBe(hashApiToken(created.token));
    expect(created.tokenHash).not.toContain(created.token);
  });

  it('rejects malformed credentials', () => {
    expect(parseApiTokenId('mdn_not-a-token')).toBeNull();
  });
});
