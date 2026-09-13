import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serializeFrontmatter } from '@metakip/shared';
import { type MarkdownRenderOptions, yDocToMarkdown } from '@metakip/shared/yjs-helpers';

export { serializeFrontmatter } from '@metakip/shared';

/**
 * Matches markdown image syntax: ![alt](src) with optional title.
 * Capture groups: 1=alt, 2=src (angle-bracket form), 3=src (bare form),
 * 4=title (double-quoted), 5=title (single-quoted), 6=title (parenthesized).
 */
const IMAGE_REGEX =
  /!\[([^\]]*)\]\((?:<([^>]*)>|([^)\s]+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\)/g;

const CODE_FENCE_REGEX = /```[\s\S]*?```/g;
const INLINE_CODE_REGEX = /`[^`]+`/g;

const PLACEHOLDER_PREFIX = '\u0000CODE_';
const PLACEHOLDER_SUFFIX = '\u0000';

interface ImageMatch {
  full: string;
  alt: string;
  src: string;
  title: string;
  titleDelim: '"' | "'" | '()' | '';
}

function maskCodeBlocks(markdown: string): { masked: string; blocks: string[] } {
  const blocks: string[] = [];
  const masked = markdown
    .replace(CODE_FENCE_REGEX, (m) => {
      blocks.push(m);
      return `${PLACEHOLDER_PREFIX}${blocks.length - 1}${PLACEHOLDER_SUFFIX}`;
    })
    .replace(INLINE_CODE_REGEX, (m) => {
      blocks.push(m);
      return `${PLACEHOLDER_PREFIX}${blocks.length - 1}${PLACEHOLDER_SUFFIX}`;
    });
  return { masked, blocks };
}

function restoreCodeBlocks(masked: string, blocks: string[]): string {
  let result = masked;
  for (let i = 0; i < blocks.length; i++) {
    result = result.replace(`${PLACEHOLDER_PREFIX}${i}${PLACEHOLDER_SUFFIX}`, blocks[i] ?? '');
  }
  return result;
}

function extractSrcFromMatch(match: RegExpExecArray): string | null {
  // Group 2 is <url> form, group 3 is bare url form
  return match[2] ?? match[3] ?? null;
}

function isValidUploadFilename(filename: string): boolean {
  if (!filename || filename.startsWith('.')) return false;
  return /^[a-zA-Z0-9\-_.]+$/.test(filename);
}

function resolveMimeType(header: string): string | null {
  const match = header.match(/data:(image\/[\w+.-]+);base64/);
  if (!match) return null;
  return match[1] ?? null;
}

const MIME_TO_EXT: Record<string, string> = {
  'vnd.microsoft.icon': 'ico',
  'x-icon': 'ico',
};

function resolveExtension(mimeType: string): string {
  const parts = mimeType.split('/');
  const subtype = parts[1] ?? 'bin';
  // Known MIME→extension mappings for non-standard subtypes
  if (MIME_TO_EXT[subtype]) return MIME_TO_EXT[subtype];
  // image/svg+xml → svg (everything after + is the vendor extension)
  const base = subtype.split('+')[0] ?? subtype;
  return base;
}

/**
 * Result of extracting images from markdown.
 */
export interface ExtractedImages {
  markdown: string;
  assets: Map<string, Buffer>;
}

/**
 * Scans markdown for images, extracts them from disk or decodes base64,
 * and rewrites references to use relative ./assets/ paths.
 *
 * Handles three image source types:
 * 1. Server URLs: /api/uploads/filename.png → read from uploads/ directory
 * 2. Base64 data URIs: data:image/png;base64,... → decode to buffer
 * 3. External URLs: https://... → left as-is (not downloaded)
 *
 * Code blocks and inline code are masked before scanning to prevent
 * image syntax inside code from being corrupted.
 */
export async function extractImages(
  markdown: string,
  uploadsDir: string,
  authorizedUploadFilenames: ReadonlySet<string>,
): Promise<ExtractedImages> {
  const { masked, blocks } = maskCodeBlocks(markdown);

  const assets = new Map<string, Buffer>();
  const urlToAssetName = new Map<string, string>();
  const contentHashToAssetName = new Map<string, string>();
  let result = masked;

  const matches: ImageMatch[] = [];
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec pattern
  while ((match = IMAGE_REGEX.exec(masked)) !== null) {
    const src = extractSrcFromMatch(match);
    if (!src) continue;
    const title = match[4] ?? match[5] ?? match[6] ?? '';
    const titleDelim =
      match[4] !== undefined
        ? '"'
        : match[5] !== undefined
          ? "'"
          : match[6] !== undefined
            ? '()'
            : '';
    matches.push({ full: match[0], alt: match[1] ?? '', src, title, titleDelim });
  }

  for (const { full, alt, src, title, titleDelim } of matches) {
    let buffer: Buffer | null = null;
    let assetName: string | null = null;

    if (src.startsWith('data:image/')) {
      const commaIdx = src.indexOf(',');
      if (commaIdx === -1) continue;

      const header = src.slice(0, commaIdx);
      const data = src.slice(commaIdx + 1);

      const mimeType = resolveMimeType(header);
      if (!mimeType) continue;

      const ext = resolveExtension(mimeType);

      try {
        const decoded = Buffer.from(data, 'base64');
        const hash = createHash('sha256').update(decoded).digest('hex').slice(0, 12);
        assetName = `image-${hash}.${ext}`;
        buffer = decoded;
      } catch {
        continue;
      }
    } else if (src.startsWith('/api/uploads/') || src.startsWith('/uploads/')) {
      const filename = src.startsWith('/api/uploads/')
        ? src.replace('/api/uploads/', '')
        : src.replace('/uploads/', '');
      if (!isValidUploadFilename(filename) || !authorizedUploadFilenames.has(filename)) continue;

      const filePath = path.join(uploadsDir, filename);
      try {
        buffer = await readFile(filePath);
        assetName = filename;
      } catch {
        continue;
      }
    } else {
      continue;
    }

    if (!buffer || !assetName) continue;

    const titlePart = title
      ? titleDelim === '()'
        ? ` (${title})`
        : ` ${titleDelim}${title}${titleDelim}`
      : '';

    if (urlToAssetName.has(src)) {
      const existing = urlToAssetName.get(src);
      if (existing) {
        result = result.replaceAll(full, `![${alt}](./assets/${existing}${titlePart})`);
      }
      continue;
    }

    const contentHash = createHash('sha256').update(buffer).digest('hex');
    const hashToName = contentHashToAssetName.get(contentHash);
    let finalName = hashToName ?? assetName;

    if (hashToName) {
      finalName = hashToName;
    } else if (assets.has(finalName) && !assets.get(finalName)?.equals(buffer)) {
      const ext = path.extname(assetName);
      const base = path.basename(assetName, ext);
      let counter = 1;
      while (assets.has(finalName) && !assets.get(finalName)?.equals(buffer)) {
        finalName = `${base}-${counter}${ext}`;
        counter++;
      }
    }

    assets.set(finalName, buffer);
    contentHashToAssetName.set(contentHash, finalName);
    urlToAssetName.set(src, finalName);
    result = result.replaceAll(full, `![${alt}](./assets/${finalName}${titlePart})`);
  }

  return { markdown: restoreCodeBlocks(result, blocks), assets };
}

/**
 * Converts a page's Yjs binary content to a full markdown document.
 *
 * The page title is deliberately not included. Markdown exports carry their
 * title in the filename, while API responses expose it as page metadata. An
 * H1 in the returned body is therefore always content authored by the user.
 */
export function pageToMarkdown(
  ydoc: Buffer | Uint8Array | null,
  properties: Record<string, unknown> | null,
  icon: string | null,
  markdownOptions?: MarkdownRenderOptions,
): string {
  let body = '';
  if (ydoc && ydoc.length > 0) {
    body = yDocToMarkdown(ydoc instanceof Buffer ? new Uint8Array(ydoc) : ydoc, markdownOptions);
  }

  const frontmatter = serializeFrontmatter(properties, icon);
  return frontmatter + body;
}
