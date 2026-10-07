import { describe, expect, it } from 'vitest';
import { createTokenRequestSchema } from './tokenContracts';

describe('create token scope requirements', () => {
  it.each([
    'pages:read',
    'pages:comment',
    'pages:write',
  ])('accepts %s without listing lower scopes', (scope) => {
    expect(createTokenRequestSchema.safeParse({ name: 'Agent', scopes: [scope] }).success).toBe(
      true,
    );
  });

  it('still rejects an explicitly empty scope list', () => {
    expect(createTokenRequestSchema.safeParse({ name: 'Agent', scopes: [] }).success).toBe(false);
  });
});
