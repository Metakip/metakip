import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAnonymousId, rotateAnonymousId } from './anonymous-cookie';

const COOKIE_NAME = 'metakip_anon_id';

function clearAnonymousCookie(): void {
  // biome-ignore lint/suspicious/noDocumentCookie: tests the document.cookie fallback directly
  document.cookie = `${COOKIE_NAME}=; max-age=0; path=/`;
}

describe('anonymous cookie identity', () => {
  afterEach(() => {
    clearAnonymousCookie();
    vi.restoreAllMocks();
  });

  it('uses a valid identity written by the server', () => {
    const serverId = '11111111-1111-4111-8111-111111111111';
    // biome-ignore lint/suspicious/noDocumentCookie: simulates a server-written cookie
    document.cookie = `${COOKIE_NAME}=${serverId}; path=/`;

    expect(getAnonymousId()).toBe(serverId);
  });

  it('creates and stores a new identity when the cookie disappears', () => {
    const firstId = '11111111-1111-4111-8111-111111111111';
    const replacementId = '22222222-2222-4222-8222-222222222222';
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(firstId).mockReturnValueOnce(replacementId);

    expect(rotateAnonymousId()).toBe(firstId);
    clearAnonymousCookie();
    expect(getAnonymousId()).toBe(replacementId);
    expect(document.cookie).toContain(`${COOKIE_NAME}=${replacementId}`);
  });

  it('replaces a malformed cookie', () => {
    const replacementId = '33333333-3333-4333-8333-333333333333';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(replacementId);
    // biome-ignore lint/suspicious/noDocumentCookie: simulates a malformed browser cookie
    document.cookie = `${COOKIE_NAME}=not-a-uuid; path=/`;

    expect(getAnonymousId()).toBe(replacementId);
    expect(document.cookie).toContain(`${COOKIE_NAME}=${replacementId}`);
  });
});
