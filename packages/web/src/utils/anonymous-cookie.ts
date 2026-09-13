const COOKIE_NAME = 'metakip_anon_id';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function setCookie(name: string, value: string, maxAge: number): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API not widely supported
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax${secure}`;
}

export function getAnonymousId(): string {
  const existing = getCookie(COOKIE_NAME);
  if (existing && UUID_PATTERN.test(existing)) {
    return existing;
  }
  return rotateAnonymousId();
}

export function rotateAnonymousId(): string {
  const id = crypto.randomUUID();
  setCookie(COOKIE_NAME, id, ONE_YEAR_SECONDS);
  return id;
}
