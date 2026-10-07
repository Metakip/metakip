import { describe, expect, it } from 'vitest';
import { hasApiTokenScope } from './apiToken';

describe('API token scope hierarchy', () => {
  it('grants read access from comment and write scopes', () => {
    expect(hasApiTokenScope(['pages:read'], 'pages:read')).toBe(true);
    expect(hasApiTokenScope(['pages:comment'], 'pages:read')).toBe(true);
    expect(hasApiTokenScope(['pages:write'], 'pages:read')).toBe(true);
  });

  it('grants comment access from comment and write scopes only', () => {
    expect(hasApiTokenScope(['pages:read'], 'pages:comment')).toBe(false);
    expect(hasApiTokenScope(['pages:comment'], 'pages:comment')).toBe(true);
    expect(hasApiTokenScope(['pages:write'], 'pages:comment')).toBe(true);
  });

  it('keeps page editing exclusive to the write scope', () => {
    expect(hasApiTokenScope(['pages:read'], 'pages:write')).toBe(false);
    expect(hasApiTokenScope(['pages:comment'], 'pages:write')).toBe(false);
    expect(hasApiTokenScope(['pages:write'], 'pages:write')).toBe(true);
  });
});
