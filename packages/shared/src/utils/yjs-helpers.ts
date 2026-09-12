import * as Y from 'yjs';
import {
  applyMarkdownReplacements,
  COLLABORATIVE_CONTENT_FIELD,
  findMarkdownWikiLinks,
  normalizeCollaborativeMarkdown,
  visitMarkdownText,
} from './collaborativeMarkdown.js';
import { normalizeWikiLinkLookupKey } from './wikiLink.js';

export type ConnectionTargetType = 'page' | 'tag' | 'user' | 'external';
export type ConnectionType = 'wikilink' | 'tag' | 'mention' | 'embed' | 'heading' | 'url';

export interface ConnectionDraft {
  targetType: ConnectionTargetType;
  targetId?: string;
  targetSlug: string;
  targetLabel: string;
  connectionType: ConnectionType;
  linkText?: string;
  linkContext?: string;
}

export interface MarkdownRenderOptions {
  resolveWikiLinkTarget?: (targetId: string) => { title: string } | null;
  restrictedWikiLinkText?: string;
}

export function yDocToMarkdown(update: Uint8Array, options: MarkdownRenderOptions = {}): string {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    const markdown = normalizeCollaborativeMarkdown(
      doc.getText(COLLABORATIVE_CONTENT_FIELD).toString(),
    );
    const replacements = findMarkdownWikiLinks(markdown).flatMap((link) => {
      if (!link.targetId) return [];
      const resolved = options.resolveWikiLinkTarget?.(link.targetId);
      if (!resolved) {
        return [
          {
            from: link.from,
            to: link.to,
            insert: options.restrictedWikiLinkText ?? 'Restricted page',
          },
        ];
      }
      const target = `${resolved.title}${link.heading ? `#${link.heading}` : ''}`;
      return [
        {
          from: link.from,
          to: link.to,
          insert: `[[${target}${link.alias ? `|${link.alias}` : ''}]]`,
        },
      ];
    });
    return applyMarkdownReplacements(markdown, replacements);
  } finally {
    doc.destroy();
  }
}

export function extractConnectionsFromYDoc(update: Uint8Array): ConnectionDraft[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    return extractConnectionsFromMarkdown(doc.getText(COLLABORATIVE_CONTENT_FIELD).toString());
  } finally {
    doc.destroy();
  }
}

export function extractWikiLinkTargetIds(update: Uint8Array): string[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    return [
      ...new Set(
        findMarkdownWikiLinks(doc.getText(COLLABORATIVE_CONTENT_FIELD).toString())
          .map((link) => link.targetId)
          .filter((targetId): targetId is string => targetId !== null),
      ),
    ];
  } finally {
    doc.destroy();
  }
}

function markdownLineContext(markdown: string, position: number): string {
  const lineStart = markdown.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const nextBreak = markdown.indexOf('\n', position);
  const lineEnd = nextBreak === -1 ? markdown.length : nextBreak;
  const line = markdown.slice(lineStart, lineEnd).trim();
  return line
    .replace(/(?<!!)\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_raw, target: string, alias?: string) =>
      (alias || target).trim(),
    )
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/[*_~`]/g, '')
    .trim();
}

function extractConnectionsFromMarkdown(markdown: string): ConnectionDraft[] {
  const normalized = normalizeCollaborativeMarkdown(markdown);
  const connections: ConnectionDraft[] = [];
  const wikiLinks = findMarkdownWikiLinks(normalized);
  for (const link of wikiLinks) {
    const targetSlug = link.targetId
      ? `id:${link.targetId}`
      : normalizeWikiLinkLookupKey(link.page);
    if (!targetSlug) continue;
    const target = `${link.page}${link.heading ? `#${link.heading}` : ''}`;
    const draft: ConnectionDraft = {
      targetType: 'page',
      targetSlug,
      targetLabel: link.targetId
        ? link.alias || target || 'Wiki link'
        : target || link.alias || 'Wiki link',
      connectionType: link.heading ? 'heading' : 'wikilink',
      linkText: link.alias || target || 'Wiki link',
    };
    if (link.targetId) draft.targetId = link.targetId;
    const context = markdownLineContext(normalized, link.from);
    if (context) draft.linkContext = context;
    connections.push(draft);
  }

  const tagPattern = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;
  visitMarkdownText(normalized, (value, from) => {
    tagPattern.lastIndex = 0;
    let match = tagPattern.exec(value);
    while (match !== null) {
      const tagPosition = from + match.index + (match[1]?.length ?? 0);
      if (wikiLinks.some((link) => tagPosition >= link.from && tagPosition < link.to)) {
        match = tagPattern.exec(value);
        continue;
      }
      const tagSlug = normalizeTagSlug(match[2] ?? '');
      if (tagSlug) {
        const context = markdownLineContext(normalized, from + match.index);
        connections.push({
          targetType: 'tag',
          targetSlug: tagSlug,
          targetLabel: tagSlug,
          connectionType: 'tag',
          linkText: tagSlug,
          ...(context ? { linkContext: context } : {}),
        });
      }
      match = tagPattern.exec(value);
    }
  });
  return connections;
}

export function normalizePageSlug(value: string): string {
  return normalizeWikiLinkLookupKey(value);
}

export function normalizeTagSlug(value: string): string {
  const trimmed = value.trim().replace(/^#+/, '').toLowerCase();
  return trimmed ? `#${trimmed}` : '';
}

export interface WikilinkMatch {
  page: string;
  blockId: string | undefined;
  heading: string | undefined;
  alias: string | undefined;
}

export function extractWikilinks(content: string): WikilinkMatch[] {
  return findMarkdownWikiLinks(content).map((link) => ({
    page: link.page,
    blockId: link.heading.startsWith('^') ? link.heading : undefined,
    heading: link.heading && !link.heading.startsWith('^') ? link.heading : undefined,
    alias: link.alias || undefined,
  }));
}
