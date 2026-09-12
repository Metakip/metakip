/**
 * Canonical lookup key for authored wiki-link paths.
 *
 * Obsidian-style paths may use Windows separators, a leading relative/root
 * marker, an optional Markdown suffix, and a heading suffix. Every producer
 * and resolver must use this exact function so the trusted target does not
 * change during a connection-index rebuild.
 */
export function normalizeWikiLinkLookupKey(value: string): string {
  const path = value.split('#')[0] ?? '';
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedWikiLinkTarget = {
  authoredTarget: string;
  targetId: string | null;
  page: string;
  heading: string;
  alias: string;
};

/** Parse the contents between `[[` and `]]` using the canonical wiki-link rules. */
export function parseWikiLinkTarget(source: string): ParsedWikiLinkTarget | null {
  if (source.includes('\n') || source.includes('\r')) return null;
  const separator = source.indexOf('|');
  const authoredTarget = (separator === -1 ? source : source.slice(0, separator)).trim();
  if (!authoredTarget) return null;

  const alias = separator === -1 ? '' : source.slice(separator + 1).trim();
  const hashIndex = authoredTarget.indexOf('#');
  const page = (hashIndex === -1 ? authoredTarget : authoredTarget.slice(0, hashIndex)).trim();
  if (!page) return null;
  const heading = hashIndex === -1 ? '' : authoredTarget.slice(hashIndex + 1).trim();
  const idCandidate = page.startsWith('id:') ? page.slice(3) : '';
  return {
    authoredTarget,
    targetId: UUID_PATTERN.test(idCandidate) ? idCandidate.toLowerCase() : null,
    page,
    heading,
    alias,
  };
}

export type WikiLinkLookupRow = {
  pageId: string;
  title: string;
  pagePath: string | null;
};

export type WikiLinkResolution = {
  pageLookup: Map<string, string>;
  targetMarkdownPaths: Map<string, string>;
};

/** Build unique authored-path bindings and safe render paths from visible pages. */
export function buildWikiLinkResolution(rows: readonly WikiLinkLookupRow[]): WikiLinkResolution {
  const candidates = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const value of [row.title, row.pagePath]) {
      if (!value) continue;
      const key = normalizeWikiLinkLookupKey(value);
      if (!key) continue;
      const ids = candidates.get(key) ?? new Set<string>();
      ids.add(row.pageId);
      candidates.set(key, ids);
    }
  }

  const pageLookup = new Map<string, string>();
  for (const [key, ids] of candidates) {
    if (ids.size !== 1) continue;
    const pageId = ids.values().next().value;
    if (pageId) pageLookup.set(key, pageId);
  }

  const targetMarkdownPaths = new Map<string, string>();
  for (const row of rows) {
    const normalizedPageId = row.pageId.toLowerCase();
    const titleTarget = pageLookup.get(normalizeWikiLinkLookupKey(row.title));
    const path =
      titleTarget?.toLowerCase() === normalizedPageId ? row.title : (row.pagePath ?? row.title);
    targetMarkdownPaths.set(normalizedPageId, path);
  }
  return { pageLookup, targetMarkdownPaths };
}
