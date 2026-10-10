import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiFetch', () => {
  it('uses a text response as the error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Service unavailable', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    await expect(apiFetch('/example')).rejects.toMatchObject({
      message: 'Service unavailable',
      status: 503,
    });
  });

  it('preserves structured invitation error codes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          message: 'Use the invited account',
          code: 'INVITATION_EMAIL_MISMATCH',
        },
        { status: 403 },
      ),
    );

    try {
      await apiFetch('/example');
      throw new Error('Expected apiFetch to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 403,
        code: 'INVITATION_EMAIL_MISMATCH',
      });
    }
  });

  it('fails loudly when a JSON response body is malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{', {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiFetch('/example')).rejects.toMatchObject({
      message: 'Request failed (500)',
      status: 500,
      cause: expect.any(SyntaxError),
    });
  });

  it.each([
    ['text/html', '<h1>Proxy error</h1>'],
    ['text/plain', ''],
  ])('uses a safe fallback for %s error responses', async (contentType, body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 502, headers: { 'Content-Type': contentType } }),
    );

    await expect(apiFetch('/example')).rejects.toMatchObject({
      message: 'Request failed (502)',
      status: 502,
    });
  });
});
