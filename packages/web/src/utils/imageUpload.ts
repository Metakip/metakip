import { type V1ImageUploadResponse, v1ImageUploadResponseSchema } from '@metakip/shared';
import { apiFetch } from './api';

export type UploadedImage = Pick<V1ImageUploadResponse, 'url' | 'markdown'>;
export type ImageUploader = (
  file: File,
  signal?: AbortSignal,
  idempotencyKey?: string,
) => Promise<UploadedImage>;

const UPLOAD_REQUEST_TIMEOUT_MS = 3 * 60 * 1000;

export async function uploadPageImage(
  file: File,
  pageId: string,
  lifecycleSignal?: AbortSignal,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<UploadedImage> {
  const controller = new AbortController();
  const abort = () => controller.abort(lifecycleSignal?.reason);
  if (lifecycleSignal?.aborted) abort();
  else lifecycleSignal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(
    () => controller.abort(new Error('Upload timed out; it may have completed.')),
    UPLOAD_REQUEST_TIMEOUT_MS,
  );
  try {
    controller.signal.throwIfAborted();
    const formData = new FormData();
    formData.append('file', file);
    const body = await apiFetch<unknown>(`/v1/pages/${encodeURIComponent(pageId)}/images`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      headers: { 'Idempotency-Key': idempotencyKey },
      signal: controller.signal,
    });
    const parsed = v1ImageUploadResponseSchema.safeParse(body);
    if (!parsed.success) throw new Error('Upload returned an invalid image response');
    return { url: parsed.data.url, markdown: parsed.data.markdown };
  } finally {
    window.clearTimeout(timeout);
    lifecycleSignal?.removeEventListener('abort', abort);
  }
}
