import * as Y from 'yjs';
import {
  COLLABORATIVE_CONTENT_FIELD,
  findMarkdownWikiLinks,
  normalizeCollaborativeMarkdown,
} from './collaborativeMarkdown.js';
import { normalizeWikiLinkLookupKey } from './wikiLink.js';

/** Create a canonical collaborative document whose body is plain Markdown. */
export function markdownToYjsState(markdown: string): Uint8Array {
  const document = new Y.Doc();
  try {
    const content = normalizeCollaborativeMarkdown(markdown);
    initializeContent(document.getText(COLLABORATIVE_CONTENT_FIELD), content);
    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}
/** Create a canonical collaborative document with independent title and body fields. */
export function createYjsDocWithTitle(title: string, markdown: string): Uint8Array {
  const document = new Y.Doc();
  try {
    document.transact(() => {
      document.getText('title').insert(0, title || 'Untitled');
      const content = normalizeCollaborativeMarkdown(markdown);
      initializeContent(document.getText(COLLABORATIVE_CONTENT_FIELD), content);
    });
    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}

function initializeContent(text: Y.Text, content: string): void {
  if (content) {
    text.insert(0, content);
    return;
  }
  // An untouched empty top-level type is absent from encoded Yjs updates.
  // A deleted seed records the canonical field without changing its value.
  text.insert(0, '\0');
  text.delete(0, 1);
}

export function createEmptyYjsDoc(title: string): Uint8Array {
  return createYjsDocWithTitle(title, '');
}

/**
 * Bind uniquely resolved authored wiki links to stable page IDs. Links that
 * are already canonical, ambiguous, or unresolved are left untouched.
 */
export function bindWikiLinkTargets(
  ydocBinary: Uint8Array,
  pageLookup: ReadonlyMap<string, string>,
): Uint8Array {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, ydocBinary);
    bindWikiLinkTargetsInDocument(document, pageLookup);
    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}

/** Bind links in-place so active collaborators retain unrelated text positions. */
export function bindWikiLinkTargetsInDocument(
  document: Y.Doc,
  pageLookup: ReadonlyMap<string, string>,
  origin: unknown = 'metakip-bind-wiki-links',
): void {
  const text = document.getText(COLLABORATIVE_CONTENT_FIELD);
  const replacements = findMarkdownWikiLinks(text.toString()).flatMap((link) => {
    if (link.targetId) return [];
    const targetId = pageLookup.get(normalizeWikiLinkLookupKey(link.page));
    if (!targetId) return [];
    const target = `id:${targetId.toLowerCase()}${link.heading ? `#${link.heading}` : ''}`;
    return [
      {
        from: link.from,
        to: link.to,
        insert: `[[${target}${link.alias ? `|${link.alias}` : ''}]]`,
      },
    ];
  });
  if (replacements.length === 0) return;
  document.transact(() => {
    for (const replacement of replacements.sort((left, right) => right.from - left.from)) {
      text.delete(replacement.from, replacement.to - replacement.from);
      text.insert(replacement.from, replacement.insert);
    }
  }, origin);
}

export function extractTitleFromYjs(ydocBinary: Uint8Array): string {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, ydocBinary);
    return document.getText('title').toString() || 'Untitled';
  } finally {
    document.destroy();
  }
}

/** Strip an imported title heading so the body does not duplicate page metadata. */
export function stripLeadingH1(markdown: string, title: string): string {
  if (!title) return markdown;
  const match = markdown.match(/^#\s+(.+)\n?/);
  if (match?.[1]?.trim() === title.trim()) return markdown.slice(match[0].length);
  return markdown;
}
