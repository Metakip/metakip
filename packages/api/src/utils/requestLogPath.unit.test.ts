import { describe, expect, it } from 'vitest';
import { requestLogPath } from './requestLogPath';

describe('requestLogPath', () => {
  it.each([
    ['/api/invitations/claim/secret', '/api/invitations/claim/:token'],
    ['/api/invitations/claim/secret/decline', '/api/invitations/claim/:token/decline'],
    ['/api/invitations/claim/secret/decline/', '/api/invitations/claim/:token/decline'],
    ['/api/invitations/claim/secret/', '/api/invitations/claim/:token'],
    ['/api/invitations/claim/secret/unexpected', '/api/invitations/claim/:token'],
    ['/api/invitations/claim//secret', '/api/invitations/claim/:token'],
    ['/invite/secret', '/invite/:token'],
    ['/invite/secret/', '/invite/:token'],
    ['/invite/secret/unexpected', '/invite/:token'],
  ])('redacts invitation tokens from %s', (path, expected) => {
    expect(requestLogPath(path)).toBe(expected);
  });

  it('preserves unrelated paths', () => {
    expect(requestLogPath('/api/invitations/id/resend')).toBe('/api/invitations/id/resend');
    expect(requestLogPath('/api/invitations/claim')).toBe('/api/invitations/claim');
  });
});
