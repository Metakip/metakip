const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  code: string | undefined;

  constructor(
    status: number,
    message: string,
    metadata: string | { code?: string } = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof metadata === 'string' ? metadata : metadata.code;
  }
}

function responseErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  if ('code' in body && typeof body.code === 'string') return body.code;
  if (!('error' in body)) return undefined;
  const error = body.error;
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function responseErrorMessage(body: unknown, status: number): string {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (!body || typeof body !== 'object') return `Request failed (${status})`;
  if ('message' in body && typeof body.message === 'string') return body.message;
  if (
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'message' in body.error &&
    typeof body.error.message === 'string'
  ) {
    return body.error.message;
  }
  return `Request failed (${status})`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    let body: unknown = null;
    if (contentType.includes('json') && text) {
      try {
        body = JSON.parse(text);
      } catch (cause) {
        // Error-response decoding is an HTTP client boundary. Preserve the
        // response status and attach the malformed payload failure as cause.
        throw new ApiError(res.status, `Request failed (${res.status})`, {}, { cause });
      }
    } else if (contentType.startsWith('text/plain')) {
      body = text;
    }
    throw new ApiError(res.status, responseErrorMessage(body, res.status), responseErrorCode(body));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
