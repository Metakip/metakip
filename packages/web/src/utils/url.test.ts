import { describe, expect, it } from 'vitest';
import {
  buildFolderPath,
  buildPagePath,
  ensureAbsoluteUrl,
  extractUuidFromSlug,
  findHttpUrls,
  getHttpUrl,
  getLegacyWorkspacePath,
  getWorkspacePath,
  getWorkspaceRootPath,
  isAppHost,
  isWorkspacePath,
} from './url';

describe('app subdomain workspace paths', () => {
  const appLocation = { hostname: 'app.metakip.com' };
  const localAppLocation = {
    hostname: 'localhost',
    origin: 'http://localhost:5173',
    port: '5173',
    protocol: 'http:',
  };
  it('uses the subdomain root without the legacy app prefix', () => {
    expect(getWorkspaceRootPath(appLocation)).toBe('/');
    expect(getWorkspacePath('settings', appLocation)).toBe('/settings');
    expect(buildPagePath('A Page', 'page-1', appLocation)).toMatch(/^\/a-page-/);
    expect(buildFolderPath('A Folder', 'folder-1', appLocation)).toMatch(/^\/folder\/a-folder-/);
  });

  it('recognizes page and folder paths on the app host', () => {
    expect(isWorkspacePath('/page-title-page-1', appLocation)).toBe(true);
    expect(isWorkspacePath('/folder/folder-title-folder-1', appLocation)).toBe(true);
    expect(isWorkspacePath('/login', appLocation)).toBe(false);
  });

  it('uses localhost as the local app host', () => {
    expect(isAppHost(localAppLocation)).toBe(true);
    expect(getWorkspaceRootPath(localAppLocation)).toBe('/');
    expect(getWorkspacePath('settings', localAppLocation)).toBe('/settings');
  });

  it('removes the legacy app prefix while preserving query and hash', () => {
    expect(getLegacyWorkspacePath('/app/folder/example', '?view=list', '#page')).toBe(
      '/folder/example?view=list#page',
    );
    expect(getLegacyWorkspacePath('/app')).toBe('/');
  });
});

describe('getHttpUrl', () => {
  it.each([
    'https://github.com/Metakip/metakip/issues/104',
    'http://example.com/path?query=value#section',
    'HTTPS://EXAMPLE.COM/path',
  ])('accepts valid direct HTTP(S) URLs: %s', (url) => {
    expect(getHttpUrl(url)).toBe(url);
  });

  it.each([
    ['example.com', 'https://example.com'],
    ['hello.com/path', 'https://hello.com/path'],
  ])('adds HTTPS to bare domains: %s', (value, expected) => {
    expect(getHttpUrl(value)).toBe(expected);
  });

  it('accepts an IP address when it has an explicit HTTP scheme', () => {
    expect(getHttpUrl('http://192.168.1.1')).toBe('http://192.168.1.1');
  });

  it('reports the URL range before terminal prose punctuation', () => {
    expect(findHttpUrls('https://example.com/path.')).toEqual([
      { from: 0, to: 24, href: 'https://example.com/path' },
    ]);
  });

  it('rejects URL matches embedded in a malformed token prefix', () => {
    expect(findHttpUrls('abchttps://example.com')).toEqual([]);
  });

  it.each([
    'Visit https://example.com',
    'ftp://example.com',
    'https://example.com\n',
    'https://',
    '192.168.1.1',
    'foo.invalidtld',
    'https://example.com/\0hidden',
    'https://example.com/\x1fhidden',
    'https://example.com/\x7fhidden',
  ])('rejects invalid direct HTTP(S) URLs: %s', (url) => {
    expect(getHttpUrl(url)).toBeUndefined();
  });
});

describe('ensureAbsoluteUrl', () => {
  // Bare domains
  it('prepends https:// to a bare domain', () => {
    expect(ensureAbsoluteUrl('samvaad.live')).toBe('https://samvaad.live');
  });

  it('prepends https:// to a www domain', () => {
    expect(ensureAbsoluteUrl('www.samvaad.live')).toBe('https://www.samvaad.live');
  });

  it('prepends https:// to a domain with a path', () => {
    expect(ensureAbsoluteUrl('samvaad.live/page')).toBe('https://samvaad.live/page');
  });

  it('prepends https:// to an IP address', () => {
    expect(ensureAbsoluteUrl('192.168.1.1')).toBe('https://192.168.1.1');
  });

  it('prepends https:// to a domain with a port', () => {
    expect(ensureAbsoluteUrl('example.com:3000')).toBe('https://example.com:3000');
  });

  // Already has a protocol
  it('leaves https:// URLs unchanged', () => {
    expect(ensureAbsoluteUrl('https://samvaad.live')).toBe('https://samvaad.live');
  });

  it('leaves http:// URLs unchanged', () => {
    expect(ensureAbsoluteUrl('http://samvaad.live')).toBe('http://samvaad.live');
  });

  it('leaves mailto: links unchanged', () => {
    expect(ensureAbsoluteUrl('mailto:test@example.com')).toBe('mailto:test@example.com');
  });

  it('leaves tel: links unchanged', () => {
    expect(ensureAbsoluteUrl('tel:+1234567890')).toBe('tel:+1234567890');
  });

  it('leaves sms: links unchanged', () => {
    expect(ensureAbsoluteUrl('sms:+1234567890')).toBe('sms:+1234567890');
  });

  it('leaves fax: links unchanged', () => {
    expect(ensureAbsoluteUrl('fax:+1234567890')).toBe('fax:+1234567890');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://samvaad.live/unsafe',
    'ftp://example.com/file',
    'custom://open',
  ])('rejects unsupported URL scheme %s', (url) => {
    expect(ensureAbsoluteUrl(url)).toBe('');
  });

  it('rejects control characters that can obscure an executable scheme', () => {
    expect(ensureAbsoluteUrl('java\nscript:alert(1)')).toBe('');
  });

  // Relative / internal
  it('leaves absolute paths unchanged', () => {
    expect(ensureAbsoluteUrl('/some/page')).toBe('/some/page');
  });

  it('leaves anchors unchanged', () => {
    expect(ensureAbsoluteUrl('#section')).toBe('#section');
  });

  it('leaves query strings unchanged', () => {
    expect(ensureAbsoluteUrl('?search=foo')).toBe('?search=foo');
  });

  it('leaves ./ relative paths unchanged', () => {
    expect(ensureAbsoluteUrl('./about')).toBe('./about');
  });

  it('leaves ../ relative paths unchanged', () => {
    expect(ensureAbsoluteUrl('../docs')).toBe('../docs');
  });

  it('leaves file-like paths with dot after slash unchanged', () => {
    expect(ensureAbsoluteUrl('docs/file.md')).toBe('docs/file.md');
  });

  it('leaves plain text without a dot unchanged', () => {
    expect(ensureAbsoluteUrl('pagename')).toBe('pagename');
  });

  // Edge cases
  it('returns empty string as-is', () => {
    expect(ensureAbsoluteUrl('')).toBe('');
  });

  it('trims whitespace before checking', () => {
    expect(ensureAbsoluteUrl('  samvaad.live  ')).toBe('https://samvaad.live');
  });
});

describe('extractUuidFromSlug', () => {
  const uuid = '550e8400-e29b-41d4-a716-446655440000';

  it('extracts uuid from slug-title-uuid format', () => {
    expect(extractUuidFromSlug(`my-page-title-${uuid}`)).toBe(uuid);
  });

  it('extracts uuid from bare uuid', () => {
    expect(extractUuidFromSlug(uuid)).toBe(uuid);
  });

  it('extracts uuid when slug has multiple hyphens', () => {
    expect(extractUuidFromSlug(`a-page-with-many-hyphens-${uuid}`)).toBe(uuid);
  });

  it('returns undefined when no uuid present', () => {
    expect(extractUuidFromSlug('just-a-regular-slug')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractUuidFromSlug('')).toBeUndefined();
  });

  it('returns undefined for malformed uuid', () => {
    expect(extractUuidFromSlug('page-550e8400-invalid')).toBeUndefined();
  });
});
