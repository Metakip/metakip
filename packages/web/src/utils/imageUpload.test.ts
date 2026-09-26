import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPageImage } from './imageUpload';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('uploadPageImage', () => {
  it('uploads a page-scoped image and parses managed Markdown', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: '65ef600d-65fa-46e7-9848-97a7a270b4af',
            url: '/api/uploads/image.png',
            markdown: '![image.png](/api/uploads/image.png)',
            filename: 'image.png',
            originalName: 'image.png',
            mimeType: 'image/png',
            size: 8,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadPageImage(new File([new Uint8Array(8)], 'image.png', { type: 'image/png' }), 'page-1'),
    ).resolves.toMatchObject({ markdown: '![image.png](/api/uploads/image.png)' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/pages/page-1/images',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Idempotency-Key': expect.any(String) },
      }),
    );

    await uploadPageImage(
      new File([new Uint8Array(8)], 'image.png', { type: 'image/png' }),
      'page-1',
      undefined,
      'same-upload-retry-key',
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/pages/page-1/images',
      expect.objectContaining({ headers: { 'Idempotency-Key': 'same-upload-retry-key' } }),
    );
  });

  it('surfaces upload errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Only images are allowed' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await expect(
      uploadPageImage(new File(['text'], 'note.txt', { type: 'text/plain' }), 'page-1'),
    ).rejects.toThrow('Only images are allowed');
  });

  it('does not retry a failed upload in the background', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'internal_error', message: 'Failed' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadPageImage(new File([new Uint8Array(8)], 'image.png', { type: 'image/png' }), 'page-1'),
    ).rejects.toThrow('Failed');
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('times out a stalled upload without retrying it', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = uploadPageImage(
      new File(['image'], 'image.png', { type: 'image/png' }),
      'page-1',
    );
    const rejected = expect(result).rejects.toThrow('Upload timed out; it may have completed.');
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('cancels an active request when its editor is retired', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const result = uploadPageImage(new File(['image'], 'image.png'), 'page-1', controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not send a request for an already retired editor', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadPageImage(new File(['image'], 'image.png'), 'page-1', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
